Heroku = require('heroku-client')
heroku = new Heroku({ token: process.env.HEROKU_API_KEY })
_ = require('lodash')

module.exports = (robot) ->

  # robot.hear /badger/i, (res) ->
  #   res.send "Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS"
  #
  # robot.respond /open the (.*) doors/i, (res) ->
  #   doorType = res.match[1]
  #   if doorType is "pod bay"
  #     res.reply "I'm afraid I can't let you do that."
  #   else
  #     res.reply "Opening #{doorType} doors"
  #
  # robot.hear /I like pie/i, (res) ->
  #   res.emote "makes a freshly baked pie"
  #
  # lulz = ['lol', 'rofl', 'lmao']
  #
  # robot.respond /lulz/i, (res) ->
  #   res.send res.random lulz
  #
  # robot.topic (res) ->
  #   res.send "#{res.message.text}? That's a Paddlin'"
  #
  #
  # enterReplies = ['Hi', 'Target Acquired', 'Firing', 'Hello friend.', 'Gotcha', 'I see you']
  # leaveReplies = ['Are you still there?', 'Target lost', 'Searching']
  #
  # robot.enter (res) ->
  #   res.send res.random enterReplies
  # robot.leave (res) ->
  #   res.send res.random leaveReplies
  #
  # answer = process.env.HUBOT_ANSWER_TO_THE_ULTIMATE_QUESTION_OF_LIFE_THE_UNIVERSE_AND_EVERYTHING
  #
  # robot.respond /what is the answer to the ultimate question of life/, (res) ->
  #   unless answer?
  #     res.send "Missing HUBOT_ANSWER_TO_THE_ULTIMATE_QUESTION_OF_LIFE_THE_UNIVERSE_AND_EVERYTHING in environment: please set and try again"
  #     return
  #   res.send "#{answer}, but what is the question?"
  #
  # robot.respond /you are a little slow/, (res) ->
  #   setTimeout () ->
  #     res.send "Who you calling 'slow'?"
  #   , 60 * 1000
  #
  # annoyIntervalId = null
  #
  # robot.respond /annoy me/, (res) ->
  #   if annoyIntervalId
  #     res.send "AAAAAAAAAAAEEEEEEEEEEEEEEEEEEEEEEEEIIIIIIIIHHHHHHHHHH"
  #     return
  #
  #   res.send "Hey, want to hear the most annoying sound in the world?"
  #   annoyIntervalId = setInterval () ->
  #     res.send "AAAAAAAAAAAEEEEEEEEEEEEEEEEEEEEEEEEIIIIIIIIHHHHHHHHHH"
  #   , 1000
  #
  # robot.respond /unannoy me/, (res) ->
  #   if annoyIntervalId
  #     res.send "GUYS, GUYS, GUYS!"
  #     clearInterval(annoyIntervalId)
  #     annoyIntervalId = null
  #   else
  #     res.send "Not annoying you right now, am I?"
  #
  #
  # robot.router.post '/hubot/chatsecrets/:room', (req, res) ->
  #   room   = req.params.room
  #   data   = JSON.parse req.body.payload
  #   secret = data.secret
  #
  #   robot.messageRoom room, "I have a secret: #{secret}"
  #
  #   res.send 'OK'
  #
  # robot.error (err, res) ->
  #   robot.logger.error "DOES NOT COMPUTE"
  #
  #   if res?
  #     res.reply "DOES NOT COMPUTE"
  #
  # robot.respond /have a soda/i, (res) ->
  #   # Get number of sodas had (coerced to a number).
  #   sodasHad = robot.brain.get('totalSodas') * 1 or 0
  #
  #   if sodasHad > 4
  #     res.reply "I'm too fizzy.."
  #
  #   else
  #     res.reply 'Sure!'
  #
  #     robot.brain.set 'totalSodas', sodasHad+1
  #
  # robot.respond /sleep it off/i, (res) ->
  #   robot.brain.set 'totalSodas', 0
  #   res.reply 'zzzzz'

  resolveAppAlias = (alias) ->
    full = {
      "staging": "timecounts-frontend-staging"
      "test": "timecounts-test"
    }[alias]
    return full if full
    matches = alias.match(/^(?:#|pr-?)([0-9]+)$/)
    if matches
      return "timecounts-fe-pr-#{matches[1]}"
    return alias

  allowed = (appName) ->
    /^(timecounts-fe-pr-|timecounts-frontend-staging$|timecounts-test$)/.test appName

  robot.respond /flags ([a-z0-9-]+)/i, (res) ->
    appName = resolveAppAlias res.match[1]
    if !allowed(appName)
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
    if !allowed(appName)
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
