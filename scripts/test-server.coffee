# Test deploy
#
# hubot deploy (test|test-api) [branch1] [branch2] - deploy code from master, branch1 and branch2 to timecounts-test/-api

_ = require('lodash')
child_process = require 'child_process'
async = require 'async'

UPDATE_TIMEOUT = 90000

quote = (str, maxLines = 10) ->
  lines = str.split("\n")
  lines = lines[-maxLines..]
  return """
    ```
    #{lines.join("\n")}
    ```
    """

output = (stdout, stderr, lines) ->
  everything = Buffer.concat([stdout, stderr])
  str = everything.toString('utf8')
  return quote str, lines


runner = (res) -> (cmd, args, options = {}, cb) ->
  if typeof options is 'function'
    cb = options
    options = {}
  options.cwd ?=
    if options.api
      "#{__dirname}/../scratchpad/timecounts-api"
    else
      "#{__dirname}/../scratchpad/timecounts-frontend"
  cp = child_process.spawn cmd, args, options
  stdout = new Buffer(0)
  stderr = new Buffer(0)
  updateUser = ->
    res.emote "is still working...\n#{output(stdout, stderr, 3)}"
  interval = setInterval updateUser, UPDATE_TIMEOUT
  cp.stdout.on 'data', (data) ->
    stdout = Buffer.concat([stdout, data])
  cp.stderr.on 'data', (data) ->
    stderr = Buffer.concat([stderr, data])
  cp.on 'close', (code) ->
    clearInterval interval
    if code isnt 0
      errorMessage = "'#{cmd} #{args.join(" ")}' failed with code #{code}\n#{output stdout, stderr}"
      return cb new Error(errorMessage)
    cb(null, output(stdout, stderr))


module.exports = (robot) ->

  deploying = false

  robot.respond /deploy (test(?:-api)?)( -f| --force)?((?: [a-z][ a-z0-9_-]+)*)/i, (res) ->
    appName = "timecounts-#{res.match[1]}"
    force = !!res.match[2]
    branches = _.compact((res.match[3] || "master").split(/[ ]+/))
    isApi = /[-]api/.test(appName)

    if force and isApi
      return res.reply "I'm sorry Dave, I'm afraid I can't do that"

    if deploying
      return res.reply "I'm already deploying! Check back later"

    deploying = true
    res.reply "I'll try and deploy '#{branches.join(", ")}' to #{appName}..."

    run = runner(res)

    options =
      api: isApi

    storedOutput = null

    storeOutput = (cb) ->
      (err, output) ->
        storedOutput = output
        cb(err, output)


    async.series
      goTest: (done) -> run "git", ["checkout", "-f", "test"], options, done
      gitFetch: (done) -> run "git", ["fetch", "--all"], options, done
      gitReset: (done) ->
        if force
          run "git", ["reset", "--hard", "origin/#{branches.shift()}"], options, done
        else
          run "git", ["reset", "--hard", "test/master"], options, done
      mergeBranches: (done) ->
        if branches.length is 0
          return done()
        else
          run "git", ["merge", branches.map((b) -> "origin/#{b}")...], options, done
      announceMergeSuccess: (done) ->
        res.reply "The merge went okay; deploying..."
        done()
      pushToHeroku: (done) ->
        if force
          run "git", ["push", "--force", "test", "test:master"], options, storeOutput done
        else
          run "git", ["push", "test", "test:master"], options, storeOutput done
      announceDeploySuccess: (done) ->
        res.reply "The latest has been deployed!\n#{storedOutput}"
        done()
      copyDatabase: (done) ->
        return done() if !isApi
        run "heroku", [
          "pg:copy"
          "timecounts-api-staging::DATABASE"
          "DATABASE"
          "--app", "timecounts-test-api"
          "--confirm", "timecounts-test-api"
        ], options, storeOutput done
      announceCopyDatabaseSuccess: (done) ->
        return done() if !isApi
        res.reply "The database has been copied from staging!\n#{storedOutput}"
        done()
      migrate: (done) ->
        return done() if !isApi
        run "heroku", ["run", "rake", "db:migrate"], options, storeOutput done
      restart: (done) ->
        return done() if !isApi
        run "heroku", ["run", "ps:restart"], options, done
      announceMigrateSuccess: (done) ->
        return done() if !isApi
        res.reply "The database has been migrated!\n#{storedOutput}"
        done()
      copyData: (done) ->
        return done() if !isApi
        run "aws", [
          "s3"
          "sync"
          "--acl", "public-read"
          "s3://timecounts-staging-assets/uploads/"
          "s3://timecounts-test-assets/uploads/"
        ], options, storeOutput done
      announceDataSuccess: (done) ->
        return done() if !isApi
        res.reply "The images have been copied!\n#{storedOutput}"
        done()
    , (err) ->
      deploying = false
      if err
        return res.reply "Sorry, couldn't do that: \n#{err.message}\n"
      return
    return
