# feature flags
#
# flags [app-name] - list the feature flags on heroku app
# flag [app-name] with +flag1 -flag2 - enable flag1, disable flag2 on heroku app

Heroku = require('heroku-client')
heroku = new Heroku({ token: process.env.HEROKU_API_KEY })
_ = require('lodash')

module.exports = (robot) ->

  resolveAppAlias = (alias) ->
    full = {
      "staging": "timecounts-frontend-staging"
      "production": "timecounts-frontend"
      "test": "timecounts-test"
    }[alias]
    return full if full
    matches = alias.match(/^(?:#|pr-?)([0-9]+)$/)
    if matches
      return "timecounts-fe-pr-#{matches[1]}"
    return alias

  allowed = (appName, user) ->
    basicAllowed = /^(timecounts-fe-pr-|timecounts-frontend-staging$|timecounts-test$)/.test(appName)
    return true if basicAllowed
    productionAllowed = /^timecounts-frontend$/.test(appName)
    return true if productionAllowed and user is 'benjie'
    return false

  robot.respond /flags ([a-z0-9-]+)/i, (res) ->
    appName = resolveAppAlias res.match[1]
    if !allowed(appName, res.message.user.name)
      return res.reply "I'm sorry Dave, I'm afraid I can't do that"
    app = heroku.apps(appName)
    app.configVars().info (err, vars) ->
      if err
        robot.logger.error(err.stack)
        res.reply("Couldn't get vars")
        return
      flags = _.pickBy(vars, (v, k) ->
        /^FLAG_/.test k
      )
      body = appName + ' flags are: \n```\n' + JSON.stringify(flags, null, 2) + '\n```'
      return res.reply body
    return

  robot.respond /flag ([a-z0-9-]+) +(?:with +)?((?:[+-]?[a-zA-Z0-9_-]+ *)+)/i, (res) ->
    appName = resolveAppAlias res.match[1]
    if !allowed(appName, res.message.user.name)
      return res.reply "I'm sorry Dave, I'm afraid I can't do that"
    flagString = res.match[2]

    parseFlagStr = (memo, str) ->
      add = true
      if str.charAt(0) == '+'
        str = str.substr(1)
      else if str.charAt(0) == '-'
        add = false
        str = str.substr(1)
      if /[a-z]/.test(str)
        str = str.replace(/([A-Z])/g, '_$1').toUpperCase()
      str = str.replace(/-/g, '_')
      str = str.replace(/__+/g, '_')
      memo['FLAG_' + str] = if add then '1' else '0'
      memo

    if flagString and flagString.length
      flagArray = flagString.split(RegExp(' +'))
      flags = flagArray.reduce(parseFlagStr, {})

    ###
    appPrefix = {
      'timecounts/timecounts-frontend': 'timecounts-fe-pr-'
    }[repo_info.owner + '/' + repo_info.name]
    if !appPrefix
      res.reply "..."
      return
    appName = appPrefix + payload.issue.number
    ###

    app = heroku.apps(appName)
    app.configVars().update flags, (err) ->
      return res.reply("Couldn't set vars") if err
      body = 'Changed flags on ' + appName + ': \n```\n' + JSON.stringify(flags, null, 2) + '\n```'
      return res.reply body
    return
