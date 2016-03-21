var Heroku = require('heroku-client');
var _ = require('underscore');
var BlinkDiff = require('blink-diff');

var heroku = new Heroku({ token: process.env.HEROKU_API_KEY });

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
  const {oldDir, newDir, diffDir} = details;
  diff = new BlinkDiff({
    imageAPath: `${oldDir}/${fileName}`,
    imageBPath: `${newDir}/${fileName}`,
    thresholdType: BlinkDiff.THRESHOLD_PERCENT,
    threshold: 0.01,
    imageOutputPath: `${diffDir}/${fileName}`,
  });
  diff.run((err, result) => {
    if (Array.isArray(result)) {
      result = result[0];
    }
    if (!diff.hasPassed(result.code)) {
      // Upload image!
      details.fails[fileName] =
        `Sadly, differences were spotted in ${fileName}:\n\n` +
        `> Image not implemented yet`;
    } else {
      details.passes++;
    }
    return done();
  });
}

function blinkCompare(baseCommit, headCommit, done) {
  const isScreenshot = filename => /^[^.].*\.png$/.test(filename);
  var oldDir = `${__dirname}/../archives/${baseCommit}`;
  var newDir = `${__dirname}/../archives/${headCommit}`;
  var diffDir = `${__dirname}/../diff/${baseCommit}-${headCommit}`;

  var oldFiles = fs.readDirSync(oldDir).filter(isScreenshot);
  var newFiles = fs.readDirSync(newDir).filter(isScreenshot);

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
    fails: 0,
    passes: 0,
    fullMessage: "",
  };
  details.fullMessage += `#### Added: \n\n- ${added.join("\n- ") || "None"}\n\n`;
  details.fullMessage += `#### Removed: \n\n- ${removed.join("\n- ") || "None"}\n\n`;
  try {
    fs.mkdir(diffDir);
  } catch(e) {
  }


  async.each(persisted, blinkDiff.bind(details), err => {
    var fails = Object.keys(details.fails).map(k => `#### ${k}\n\n${details.fails[k]}\n`);
    details.pass = fails.length === 0;
    if (!details.pass) {
      details.message = `${fails.length} fails occurred (${details.passes} passes)`;
      details.fullMessage += fails.join("\n\n");
    } else {
      details.message = `${details.passes} checks passed`;
    }
    return done(err, details);
  });

}

function build(task, cb) {
  var baseCommit = task[0];
  var headCommit = task[1];
  var callback = task[2];
  var done = function(err, details) {
    cb();
    callback(err, details);
  }
  var cp = child_process.spawn(`${__dirname}/../visdiff`, [baseCommit, headCommit]);
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

exports.blinkCompare = blinkCompare;
exports.blinkDiff = blinkDiff;
