var Heroku = require('heroku-client');
var _ = require('underscore');
var BlinkDiff = require('blink-diff');
var fs = require('fs');
var async = require('async');
var s3 = require('s3');

var s3Client = s3.createClient({
  s3Options: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  }
})

var heroku = new Heroku({ token: process.env.HEROKU_API_KEY });
var ROOT = `${__dirname}/../..`;
var baseS3Key = null;
const BUCKET_NAME = 'timecounts-test';

module.exports = function pong(bot, repo_info, payload) {
  var comment_options
    , options = {user: repo_info.owner, repo: repo_info.name}
    , should_pong;

  should_pong = payload.comment.user.login.toLowerCase() !== bot.options.username &&
                payload.issue.changed_files &&
                (matches = payload.comment.body.match(/^\/visual(\s|$)/));

  if (!should_pong) {
    return;
  }
  var appPrefix = {
    "timecounts/timecounts-frontend": "timecounts-fe-pr-",
  }[repo_info.owner + '/' + repo_info.name];
  if (!appPrefix) {
    bot.trace('* [Flag] Flag command on the issue #' + payload.issue.number +
              ' on the repo ' + repo_info.owner + '/' + repo_info.name) +
              ' was invalid - unsupported repo!';
    return;
  }
  var appName = appPrefix + payload.issue.number;
  function send(body) {
    comment_options = _.extend({
      number: payload.issue.number
    , body: body
    }, options);

    bot.github.issues.createComment(comment_options, bot.handleError(function (data) {
      bot.trace('* [Flag] Answered flag on the issue #' + payload.issue.number +
                ' on the repo ' + repo_info.owner + '/' + repo_info.name + ': ' +
                body);
    }));
  }

  var baseCommit = payload.issue.base.sha;
  var headCommit = payload.issue.head.sha;

  function createStatus(commit, status, message) {
    var params = {
      state: status,
      description: message,
      context: 'visual-regression',
    };
    heroku.post(`/repos/${repo_info.owner}/${repo_info.name}/statuses/${commit}`, params, function(err, app) {
      if (err) {
        console.error(`ERROR OCCURRED SETTING STATUS ${status} on commit ${commit}: ${err.message}`);
        console.error(err.stack);
      }
    });
  }

  // 1. Add status
  createStatus(headCommit, 'pending');
  // 2. Run build (queue?)
  // 3. Update status

  queueBuild(baseCommit, headCommit, function(err, details) {
    if (err) {
      createStatus(headCommit, 'error', err.message);
      send("Error occurred\n```\n" + err.stack + "\n```\n")
    } else if (!details.pass) {
      createStatus(headCommit, 'failure', details.shortMessage);
      send(details.fullMessage);
    } else {
      createStatus(headCommit, 'success');
    }
  });

};

var queue = [];

function blinkDiff(details, fileName, done) {
  const oldDir = details.oldDir;
  const newDir = details.newDir;
  const diffDir = details.diffDir;
  const imageOutputPath = `${diffDir}/${fileName}`;
  diff = new BlinkDiff({
    imageAPath: `${oldDir}/${fileName}`,
    imageBPath: `${newDir}/${fileName}`,
    thresholdType: BlinkDiff.THRESHOLD_PERCENT,
    threshold: 0.01,
    imageOutputPath,
  });
  diff.run((err, result) => {
    const title = fileName.replace(/--/g, ": ").replace(/-+/g, " ");
    if (err) {
      console.error(err.stack);
      details.fails[fileName] = {
        differences: 0,
        body: `#### ${title}\n\n` + "An error occurred: \n\n```\n" + err.stack + "\n```\n"
      };
      return;
    }
    if (Array.isArray(result)) {
      result = result[0];
    }
    console.log(`Diff[${fileName}]: ${result.differences}`);
    if (!diff.hasPassed(result.code)) {
      // Upload image!
      const key = `${baseS3Key || 'testing'}/${fileName}`
      const params = {
        localFile: imageOutputPath,
        s3Params: {
          Bucket: BUCKET_NAME,
          Key: key,
          ACL: 'public-read',
          StorageClass: 'REDUCED_REDUNDANCY',
        }
      }
      const uploader = s3Client.uploadFile(params);
      uploader.on('error', err => {
        details.fails[fileName] = Object.assign({}, result, {
          differences: 0,
          body:
            `#### ${title}\n\n` +
            `> Image failed to upload`
        });
        return done();
      });
      uploader.on('end', () => {
        const url = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
        details.fails[fileName] = Object.assign({}, result, {
          body:
            `#### ${title}\n\n` +
            `Differences: ${result.differences}\n`+
            `![](${url})`
        });
        return done();
      })
    } else {
      details.passes++;
      return done();
    }
  });
}

function blinkCompare(baseCommit, headCommit, done) {
  const isScreenshot = filename => /^[^.].*\.png$/.test(filename);
  var oldDir = `${ROOT}/archive/${baseCommit}`;
  var newDir = `${ROOT}/archive/${headCommit}`;
  var diffDir = `${ROOT}/diff/${baseCommit}-${headCommit}`;

  var oldFiles = fs.readdirSync(oldDir).filter(isScreenshot);
  var newFiles = fs.readdirSync(newDir).filter(isScreenshot);

  var added = newFiles.filter(f => oldFiles.indexOf(f) < 0);
  var removed = oldFiles.filter(f => newFiles.indexOf(f) < 0);
  var persisted = newFiles.filter(f => added.indexOf(f) < 0 && removed.indexOf(f) < 0);

  var details = {
    oldDir,
    newDir,
    diffDir,
    added,
    removed,
    persisted,
    fails: {},
    passes: 0,
    fullMessage: "",
  };
  details.fullMessage += `#### Added: \n\n- ${added.join("\n- ") || "None"}\n\n`;
  details.fullMessage += `#### Removed: \n\n- ${removed.join("\n- ") || "None"}\n\n`;
  try {
    fs.mkdirSync(diffDir);
  } catch(e) {
  }


  async.eachLimit(persisted, 3, blinkDiff.bind(null, details), err => {
    var fails = Object.keys(details.fails).map(k => details.fails[k]);
    fails.sort((a, b) => b.differences - a.differences);
    details.pass = fails.length === 0;
    if (!details.pass) {
      details.message = `${fails.length} fails occurred (${details.passes} passes)`;
      details.fullMessage += fails.map(f => f.body).join("\n\n");
    } else {
      details.message = `${details.passes} checks passed`;
    }
    return done(err, details);
  });

}

function build(task, cb) {
  baseS3Key = `visual-diff/${new Date().toISOString().replace(/[^a-z0-9.-]/g, "_")}`;
  var baseCommit = task[0];
  var headCommit = task[1];
  var callback = task[2];
  var done = function(err, details) {
    cb();
    callback(err, details);
  }
  var cp = child_process.spawn(`${ROOT}/visdiff`, [baseCommit, headCommit]);
  var stdout = new Buffer(0);
  var stderr = new Buffer(0);
  cp.stdout.on('data', d => stdout = Buffer.concat([stdout, d]));
  cp.stderr.on('data', d => stderr = Buffer.concat([stderr, d]));
  cp.on('exit', function(code, signal) {
    var err = null;
    if (signal) {
      err = new Error(`Build terminated with signal ${signal}`);
    } else if (code > 0) {
      err = new Error(`Build exited with code ${code}`);
    }
    if (err) {
      return done(err);
    }
    // Do the blink comparison
    blinkCompare(baseCommit, headCommit, done);

  });
}

function runQueue() {
  if (queue.length > 1) {
    build(queue[0], function() {
      queue.unshift();
      runQueue();
    });
  }
}

function queueBuild(baseCommit, headCommit, callback) {
  queue.push([baseCommit, headCommit, callback]);
  if (queue.length === 1) {
    runQueue();
  }
}

module.exports.blinkCompare = blinkCompare;
module.exports.blinkDiff = blinkDiff;
