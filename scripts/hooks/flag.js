var Heroku = require('heroku-client'),
    heroku = new Heroku({ token: process.env.HEROKU_API_KEY });

module.exports = function pong(bot, repo_info, payload) {
  var comment_options
    , options = {user: repo_info.owner, repo: repo_info.name}
    , should_pong;

  should_pong = payload.comment.user.login.toLowerCase() !== bot.options.username &&
                (matches = payload.comment.body.match(/^\/flag +((?:[+-]?[a-zA-Z0-9_-]+ *)+)/));

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
  var flagArray = flagString.split(/ +/)
  var flags = flagArray.reduce(parseFlagStr, {});
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
  app.configVars().update(flags, bot.handleError(function () {
    var body = 'Changed flags on ' + appName + ': ' + JSON.stringify(flags);
    comment_options = _.extend({
      number: payload.issue.number
    , body: body
    }, options);

    bot.github.issues.createComment(comment_options, bot.handleError(function (data) {
      bot.trace('* [Flag] Answered flag on the issue #' + payload.issue.number +
                ' on the repo ' + repo_info.owner + '/' + repo_info.name + ': ' +
                JSON.stringify(flags));
    }));
  }));
};
