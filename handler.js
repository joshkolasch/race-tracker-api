const connectToDatabase = require('./db')
const Data = require('./Data')
const Utils = require('./utils')
let generateID = Utils.generateID
let generateTimestamp = Utils.generateTimestamp

require('dotenv').config({ path: './variables.env'})
'use strict';


/*
Event: {
  _id: 1234,
  type: 'event',
  lastModified: 123456789
  body: {
    name: 'Sunny Hills Relay',
    unitOfMeasure: 'kilometers',
    timezone: 'mountain',
    totalDistance: 55.3,
    heats: {
      'Key1': {
        name: '50K slow starters',
        startTime: 11:00AM
      },
      'Key2': {
        name: '50K fast starters',
        startTime: 11:30AM
      }
    }
    checkpoints: {
      'Key1': {
        name: 'Red Hollow Aid Station 1',
        distance: '4.5 K',
        difficulty: 'moderate',
        coordinates: {
          latitude: 40.741895,
          longitude: -73.989308
        }
      },
      'Key2': {
        name: 'office',
        distance: '2.2K',
        difficulty: 'hard',
        coordinates: {
          latitude: 40.741890,
          longitude: -73.989300
        }
      }
    }
    runners: [
      123456790,
      123456791,
      123456792
    ]
  }
}
Runner {
  _id: 123456790,
  type: 'runner',
  lastModified: 12341234,
  body: {
    name: 'Jay Jamison',
    eventID: 123456789
    bib: 001,
    splits: {
      'Key1': '12:15AM',
      'Key2': '12:45AM'
    }
  }
}
*/

module.exports.createEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { name, timezone, unitOfMeasure, totalDistance, checkpoints, heats, runners } = JSON.parse(event.body)
      console.log('event body', event.body)
      name = validateString(name)
      if(name === null) {callback(null, {statusCode: 500, headers: { 'Content-type': 'text/plain'}, body: 'Invalid Name'})}
      timezone = validateTimezone(timezone)
      if(timezone === null) {callback(null, {statusCode: 500, headers: { 'Content-type': 'text/plain'}, body: 'Invalid Timezone'})}
      unitOfMeasure = validateUnitOfMeasure(unitOfMeasure) 
      totalDistance = validateNumber(totalDistance) 
      validateCheckpoints(checkpoints) ? null : callback(null, {statusCode: 500, headers: { 'Content-type': 'text/plain'}, body: 'Invalid Checkpoint'})
      validateHeats(heats) ? null : callback(null, {statusCode: 500, headers: { 'Content-type': 'text/plain'}, body: 'Invalid Heats'})
      validateRunners(runners) ? null : callback(null, {statusCode: 500, headers: { 'Content-type': 'text/plain'}, body: 'Invalid Runners'})
      const _id = generateID()

      const newEvent = {
        _id,
        type: 'event',
        lastModified: generateTimestamp(),
        body: {
          name,
          timezone,
          unitOfMeasure,
          totalDistance,
          checkpoints: { ...checkpoints },
          heats: { ...heats },
          runners: []
        }
      }

      Data.create(newEvent)
        .then(result => {
          /*let runnersToAdd = []

          for(runner in runners) {
            runnersToAdd.push(addRunner(runner, _id))
          }

          Promise.all(runnersToAdd)
            .then(runnerResults => callback(null, {
              statusCode: 200,
              body: JSON.stringify(result)
            }))
            .catch(err => callback(null, {
              statusCode: err.statusCode || 500,
              headers: { 'Content-type': 'text/plain' },
              body: 'Error adding runners'
            }))
          */
         console.log('result', result)
         return callback(null, successResponse(200, result))

        })
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Content-type': 'text/plain' },
          body: 'Could not create event.'
        }))
    })
}


module.exports.createRunner = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { eventID, runner } = JSON.parse(event.body)
      //TODO: validateRunner & eventID
      //if(!validateID(eventID)) {callback(null, errorResponse(null, 'Invalid Event ID'))}
      //if(!validateRunner(runner)) {callback(null, errorResponse(null, 'Invalid Runner'))}

      const eventCondition = {_id: eventID, type: 'event'}
      
      Data.findOne(eventCondition)
        .then(results => {
          const eventResults = results._doc

          const duplicateCheck = eventResults.body.runners.filter((item) => item.bib === runner.bib)
          console.log('duplicateCheck: ', duplicateCheck)

          if (duplicateCheck.length > 0) 
          {
            return callback(null, errorResponse(501, 'Runner already exists')) 
          }
          else if (!eventResults.body.heats.hasOwnProperty(runner.heat))
          {
            return callback(null, errorResponse(501, 'Heat does not exist in event'))
          }
          else {
            const newRunner = generateRunner(runner, eventID)
            //console.log('new runner', newRunner)

            let addRunnerToDatabase = () => (
              Data.create(newRunner)
            ) 

            let updateEvent = () => {
              const updateCondition = {
                _id: eventID,
                type: 'event'
              }
              const updateInfo = {
                ...eventResults,
                lastModified: generateTimestamp(),
                body: {
                  ...eventResults.body,
                  runners: [
                    ...eventResults.body.runners,
                    {
                      _id: newRunner._id,
                      bib: newRunner.body.bib
                    }
                    
                  ]
                }
              }
              const options = {
                new: true
              }
              return Data.findOneAndUpdate(updateCondition, updateInfo, options)
            }

            Promise.all([
              addRunnerToDatabase(),
              updateEvent()
            ])
              .then(secondResults => {
                const addResults = secondResults[0]._doc
                const updateResults = secondResults[1]._doc
                //console.log('add results', addResults)
                //console.log('update event results', updateResults)
                newResponse = {
                  event: {
                    ...updateResults
                  },
                  runner: {
                    ...addResults
                  }
                }
                return callback(null, successResponse(200, newResponse))
              })
              .catch(err => callback(null, errorResponse(err.statusCode, 'Could not add runner to database')))
          }
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Unable to find event')))
    })
}


module.exports.createRunners = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { eventID, runners } = JSON.parse(event.body)
      //TODO: validate eventID
      //TODO: validate runners
      //TODO: check to make sure none of the runners have duplicate bib #'s [check #1]
      let findEvent = () => {
        const eventCondition = {_id: eventID, type: 'event'}
        return Data.findOne(eventCondition)
      }

      findEvent()
        .then(result => {
          const resultEvent = result._doc
          //return results, plus the runners that were duplicate(and thus not added, from both checks)
          let validRunners = []
          let invalidRunners = []
          /*const eventBibs = resultEvent.body.runners.reduce((accumulator, currentRunner, index) => {
            accumulator[currentRunner.bib] = 1
          }, {})*/

          let eventBibs = {}
          for (let i = 0; i < resultEvent.body.runners.length; i++) {
            //console.log(resultEvent.body.runners[i])
            eventBibs[resultEvent.body.runners[i].bib] = 1
          }
          
          let allBibs = {}

          //console.log('eventBibs', eventBibs)

          for (let i = 0; i < runners.length; i++) {
            /*
            //NOTE: this check should be done first! do it becore allBibs.hasOwnProperty(runner.bib)
            if (!isValidRunner(runner)) {
              invalidRunners.push({
                ...runner,
                errMessage: 'Invalidly formatted runner'
              }) 
            }
            else if (stuff below)*/
           if(allBibs.hasOwnProperty(runners[i].bib)) {
              invalidRunners.push({
                ...runners[i],
                errMessage: 'User submitted runners with duplicate bib'
              })
            }
            
            else if(eventBibs.hasOwnProperty(runners[i].bib)) {
              invalidRunners.push({
                ...runners[i],
                errMessage: 'Bib already taken by an existing runner.'
              })
            }
            else {
              validRunners.push(runners[i])
            }
            allBibs[runners[i].bib] = 1
          }

          //console.log('valid runners', validRunners)
          //console.log('all bibs', allBibs)

          const formattedRunners = validRunners.map(runner => generateRunner(runner, resultEvent._id))
          let runnersToAdd = formattedRunners.map(runner => {
            return Data.create(runner)
          })
          //console.log('formatted runners: ', formattedRunners)

          //can i replace ...runnersToAdd with formattedRunners.map(runner=>{}) ??? to reduce memory complexity
          Promise.all([...runnersToAdd])
            .then(addResults => {
              console.log('Add Results: ', addResults)
              const addedRunners = addResults.map(item => ({
                _id: item._id,
                bib: item.body.bib
              }))
              console.log('added Runners', addedRunners)

              const updateValues = {
                lastModified: generateTimestamp(),
                '$push': {
                  'body.runners': {'$each': addedRunners}
                }
              }

              const condition = {
                _id: resultEvent._id, 
                type: 'event', 
              }

              const options = {new: true}
              //return callback(null, successResponse(200, 'Great'))
              
              Data.findOneAndUpdate(condition, updateValues, options)
                .then(updateResults => {
                  console.log('updated Event', updateResults)
                  const response = {
                    event: {
                      ...updateResults._doc
                    },
                    runners: {
                      ...formattedRunners
                    },
                    invalidRunners: {
                      ...invalidRunners
                    }
                  }
                  return callback(null, successResponse(200, response))

                })
                .catch(err => callback(null, errorResponse(err.statusCode, 'Could not update event')))

            })
            .catch(err => callback(null, errorResponse(err.statusCode, 'Error adding runners')))

        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Could not find event')))

      
    })
}

module.exports.getAll = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      Data.find()
        .then(data => callback(null, {
          statusCode: 200,
          body: JSON.stringify(data)
        }))
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not get all data.', 
        }))
    })
}

module.exports.deleteAll = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      Data.remove({})
        .then(deleteData => callback(null, successResponse(200, deleteData)))
    })
}

//TODO: populateRunners() {}
//TODO: addHeat () {}
//TODO: removeHeat() {}
//TODO: updateHeat() {}
//TODO: addRunner() {}
//TODO: deleteRunner() {}
//TODO: updateRunner() {}




function validateString (input) {
  if (typeof(input) !== 'string')
  {
    return null
  }
  return input
}

function validateTimezone (input) {
  return input
}

function validateUnitOfMeasure (input) {
  const UNITS = ['kilometers', 'meters', 'miles', 'feet']

  if(!input) {
    return ''
  }

  if(!UNITS.includes(input)) {
    return ''
  }
  return input
}

function validateNumber (input) {
  return input
}

function validateCheckpoints (input) {
  return true
}

function validateHeats (input) {
  return true
}

function validateRunners (input) {
  return true
}

function generateRunner (runner, eventID) {
  const { name, bib, heat } = runner

  const newRunner = {
    _id: generateID(),
    type: 'runner', 
    lastModified: generateTimestamp(),
    body: {
      eventID,
      name,
      bib,
      heat,
      splits: null
    }
  }
  return newRunner
}

function errorResponse(statusCode, errorMessage) {
  return {
    statusCode: statusCode || 500,
    headers: { 'Context-Type': 'text/plain' },
    body: errorMessage 
  }
}

function successResponse(statusCode, body) {
  return {
    statusCode: statusCode || 200,
    body: JSON.stringify(body)
  }
}

//function addRunner(runner, eventID)

//find duplicates 
/*
let findDuplicateRunners = runners.map((runner) => {
  const duplicateFilter = {
    type: 'runner',
    'body.eventID': eventID,
    'body.bib': runner.bib
  }
  return Data.countDocuments(duplicateFilter)
})
//console.log('dup runners array', findDuplicateRunners)

Promise.all(findDuplicateRunners)
  .then(results => {
    console.log('Results:\n', results)
    console.log('R[0]:\n', results[0])
    console.log('R[1]:\n', results[1])
    return callback(null, successResponse(200, results[0]))
  })
  .catch(err => callback(null, errorResponse(err.statusCode, 'Could not find duplicates')))
*/