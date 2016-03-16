var Heroku = require('heroku-client'),
    heroku = new Heroku({ token: process.env.HEROKU_API_KEY });
var _ = require('underscore');

module.exports = function pong(bot, repo_info, payload) {
  var comment_options
    , options = {user: repo_info.owner, repo: repo_info.name}
    , should_pong;

  should_pong = payload.comment.user.login.toLowerCase() !== bot.options.username &&
                (matches = payload.comment.body.match(/^\/flags?(?: +((?:[+-]?[a-zA-Z0-9_-]+ *)+))?($|\r|\n)/));

  if (!should_pong) {
    return;
  }
  if (payload.issue.state !== "open") {
    bot.trace('* [Flag] Flag command on the issue #' + payload.issue.number +
              ' on the repo ' + repo_info.owner + '/' + repo_info.name) +
              ' was invalid - closed!';
    return;
  }
  function parseFlagStr(memo, str) {
    var add = true;
    if (str.charAt(0) === "+") {
      str = str.substr(1);
    } else if (str.charAt(0) === "-") {
      add = false;
      str = str.substr(1);
    }
    if (/[a-z]/.test(str)) {
      str = str.replace(/([A-Z])/g, "_$1").toUpperCase();
    }
    str = str.replace(/-/g, "_");
    str = str.replace(/__+/g, "_");
    memo["FLAG_" + str] = (add ? "1" : "0");
    return memo;
  }
  var flagString = matches[1];
  var flags;
  if (flagString && flagString.length) {
    var flagArray = flagString.split(/ +/)
    flags = flagArray.reduce(parseFlagStr, {});
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
  var app = heroku.apps(appName);
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
  if (flags) {
    app.configVars().update(flags, bot.handleError(function () {
      var body = 'Changed flags on ' + appName + ': \n```json\n' + JSON.stringify(flags, null, 2) + '\n```';
      send(body);
    }));
  } else {
    app.configVars().info(bot.handleError(function (vars) {
      var flags = _.pick(vars, (v, k) => /^FLAG_/.test(k));
      var body = appName + ' flags are: \n```json\n' + JSON.stringify(flags, null, 2) + '\n```';
      send(body);
    }));
  }
};
