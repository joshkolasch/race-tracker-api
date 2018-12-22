'use strict'
const connectToDatabase = require('./db')
const Data = require('./Data')
const Utils = require('./utils')
let { generateID, generateTimestamp, isValidObjectID, convertToObjectID } = Utils
let sanitize = require('mongo-sanitize')

require('dotenv').config({ path: './variables.env'})

module.exports.getEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID } = event.queryStringParameters

      if(!validID(eventID)) {
        return callback(null, errorResponse(501, "Invalid event ID"))
      }

      findEvent(eventID)
        .then(result => {
          if(result === null) {
            return callback(null, errorResponse(501, 'Event does not exist'))
          }

          return callback(null, successResponse(200, result))

        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding event')))
    })
}

module.exports.createEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { name, unitOfMeasure, totalDistance } = JSON.parse(event.body)

      //validation
      name = sanitize(name)
      if(!validString(name)){
        return callback(null, {statusCode: 500, headers: { 'Content-type': 'text/plain'}, body: 'Invalid Name'})
      }

      unitOfMeasure = formatUnitOfMeasure(unitOfMeasure)

      totalDistance = formatNumber(totalDistance)

      const newEvent = generateEvent({name, unitOfMeasure, totalDistance})

      Data.create(newEvent)
        .then(result => callback(null, successResponse(200, result)))
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error creating the event')))
    })
}

module.exports.getRunners = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID } = event.queryStringParameters 
      const runnerIDs = event.queryStringParameters.runnerIDs.split(',')

      if(!validID(eventID)) {
        return callback(null, errorResponse(501, 'Invalid event ID'))
      }

      let validRunnerIDs = {}
      let invalidRunnerIDs = []

      if(!runnerIDs) {
        return callback(null, errorResponse(501, 'Runners not provided'))
      }

      //sort out valid runner IDs and invalid runner IDs
      runnerIDs.forEach(id => {
        if(!validID(id)) {
          invalidRunnerIDs.push({
            id,
            errMessage: 'Invalid runner ID'
          })
        }
        else if(validRunnerIDs.hasOwnProperty(id)) {
          invalidRunnerIDs.push({
            id,
            errMessage: 'User submitted duplicate runner IDs'
          })
        }
        else {
          validRunnerIDs[id] = 1
        }
      })

      //convert hash table to an array, 
      //NOTE: Array has.length property and .map capability
      //TODO: can I keep my hash table rather than converting it into an array??? [to reduce memory complexity]
      let runnersToFind = Object.keys(validRunnerIDs)

      if(runnersToFind.length < 1) {
        const response = {
          errMessage: 'No valid Runners to get',
          invalidRunnerIDs
        }
        return callback(null, errorResponse(501, response))
      }

      runnersToFind = runnersToFind.map(id => {
          const conditions = { _id: id, type: 'runner' }
          return Data.findOne(conditions)
      })

      Promise.all(runnersToFind)
        .then(findResults => {
          let foundRunners = []

          //sort out runners that were found from ones that don't exist
          for(let i = 0; i < findResults.length; i += 1) {
            if(findResults[i] === null) {
              const id = Object.keys(validRunnerIDs)[i]
              invalidRunnerIDs.push({
                id,
                errMessage: 'Runner does not exist'
              })
            }
            else {
              foundRunners.push(findResults[i])
            }
          }
          
          const response = {
            runners: foundRunners,
            invalidRunnerIDs
          }
          return callback(null, successResponse(200, response))
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding the runners')))
    })
    .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding the event')))
}

module.exports.createRunners = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { eventID, runners } = JSON.parse(event.body) 
      if (!validID(eventID)) {
        return callback(null, callback(501, 'EventID not formatted correctly'))
      }

      findEvent(eventID)
        .then(resultEvent => {
          
          let validRunners = [] 
          let invalidRunners = [] 

          //current existing bibs in the Event
          let eventBibs = {}

          resultEvent.body.runners.forEach(runner => {
            eventBibs[runner.bib] = 1
          })

          //current existing heat names
          let eventHeatNames = {}

          Object.keys(resultEvent.body.heats).forEach(key => {
            eventHeatNames[resultEvent.body.heats[key].name] = 1
          })
          
          let submittedBibs = {}

          //sort out valid and invalid runners
          runners.forEach((runner) => {
            //NOTE: this check should be done first! do it before submittedBibs.hasOwnProperty(runner.bib)
            if(!validRunnerFormat(runner)) {
              invalidRunners.push({
                ...runner,
                errMessage: 'Invalidly formatted runner'
              })
            }
            else if(submittedBibs.hasOwnProperty(runner.bib)) {
              invalidRunners.push({
                ...runner,
                errMessage: 'User submitted runners with duplicate bib'
              })
            }
            else if(eventBibs.hasOwnProperty(runner.bib)) {
              invalidRunners.push({
                ...runner,
                errMessage: 'Bib already taken by an existing runner'
              })
            }
            else if(eventHeatNames.hasOwnProperty(runner.heat)) {
              invalidRunners.push({
                ...runner,
                errMessage: 'Heat not found in event'
              })
            }
            else {
              validRunners.push(runner)
              //hash table of all bibs about to be added; necessary to prevent duplicate user submissions
              submittedBibs[runner.bib] = 1
            }
          })

          //escape early if there are no valid runners
          if(validRunners.length < 1) {
            const response = {
              errMessage: 'No valid runners to add',
              invalidRunners
            }
            return callback(null, errorResponse(501, response))
          }

          //produce an array of Runners to add to the database
          const formattedRunners = validRunners.map(runner => generateRunner(runner, resultEvent._id))
          let runnersToAdd = formattedRunners.map(runner => {
            return Data.create(runner)
          })

          //TODO: can i replace ...runnersToAdd with formattedRunners.map(runner=>{}) ??? to reduce memory complexity
          //OR: can i do another .map(formattedRunner => {return Data.create(formattedRunner)}) at the end of the first .map() ???
          Promise.all(runnersToAdd)
            .then(addResults => {
              //TODO: check to make sure that each promise returns a valid runner [what does failed promise look like?]
              const addedRunners = addResults.map(item => ({
                _id: item._id,
                bib: item.body.bib
              }))

              const updateValues = {
                lastModified: generateTimestamp(),
                '$push': {
                  'body.runners': {'$each': addedRunners}
                }
              }

              const conditions = {
                _id: resultEvent._id, 
                type: 'event', 
              }

              const options = { 
                new: true, 
                lean: true 
              }
              
              //update the Event with the successfully added Runners
              Data.findOneAndUpdate(conditions, updateValues, options)
                .then(updateResults => {
                  const response = {
                    event: {
                      ...updateResults
                    },
                    runners: [
                      ...formattedRunners
                    ],
                    invalidRunners
                  }
                  return callback(null, successResponse(200, response))
                })
                .catch(err => callback(null, errorResponse(err.statusCode, 'Error updating the event')))
            })
            .catch(err => callback(null, errorResponse(err.statusCode, 'Error adding runners')))
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding the event')))
    })
}

module.exports.getAll = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      Data.find()
        .then(data => callback(null, successResponse(200, data)))
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error getting the data.')))
    })
}

module.exports.deleteAll = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      Data.remove({})
        .then(deleteData => callback(null, successResponse(200, deleteData)))
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error removing the data')))
    })
}

module.exports.addHeats = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID, heats } = JSON.parse(event.body)
      if(!validID(eventID)) {
        return callback(null, errorResponse(501, 'Invalid eventID'))
      }

      findEvent(eventID)
        .then(resultEvent => {
          let invalidHeats = []
          let validHeats = []
          let eventHeatNames = {}
          let submittedHeatNames = {}
          
          //get all the heat names from the Event
          Object.keys(resultEvent.body.heats).forEach(key => {
            eventHeatNames[resultEvent.body.heats[key].name] = 1
          })

          //sort out valid heats and invalid heats
          heats.forEach(heat => {
            if(!validHeatFormat(heat)) {
              invalidHeats.push({
                ...heat,
                errMessage: 'Invalid heat format'
              })
            }
            else if(eventHeatNames.hasOwnProperty(heat.name)) {
              invalidHeats.push({
                ...heat,
                errMessage: 'Heat already exists in the event'
              })
            }
            else if(submittedHeatNames.hasOwnProperty(heat.name)) {
              invalidHeats.push({
                ...heat,
                errMessage: 'User submitted heat with duplicate name'
              })
            }
            else {
              validHeats.push({
                name: heat.name
              })
              submittedHeatNames[heat.name] = 1
            }
          })
          
          //escape early if there are no valid heats
          if(validHeats.length < 1) {
            const response = {
              errMessage: 'No valid heats to add',
              invalidHeats
            }
            return callback(null, errorResponse(501, response))
          }

          const formattedHeats = validHeats.map(heat => {return generateHeat(heat)})

          //newHeats object that will hold existing heats + new valid heats
          let newHeats = {}
          for(let heat in resultEvent.body.heats) {
            newHeats[heat] = resultEvent.body.heats[heat]
          }
          formattedHeats.forEach(heat => {
            newHeats[heat._id] = {
              name: heat.name,
              startTime: heat.startTime
            }
          })

          const conditions = { _id: eventID, type: 'event' }

          const updateValues = {
            lastModified: generateTimestamp(),
            'body.heats': newHeats
          }

          const options = { 
            new: true,
            lean: true
          }
          
          //update the Event
          Data.findOneAndUpdate(conditions, updateValues, options)
            .then(updateResults => {
              const response = {
                event: {
                  ...updateResults
                },
                heats: [
                  ...formattedHeats
                ],
                invalidHeats
              }
              return callback(null, successResponse(200, response))
            })
            .catch(err => callback(null, errorResponse(err.statusCode, 'Error updating the event')))
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding the event')))
    })
}

module.exports.removeHeats = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID, heatIDs } = JSON.parse(event.body)
      if(!validID(eventID)) {
        return callback(null, errorResponse(501, 'Invalid eventID'))
      }
      if(heatIDs === null) {
        return callback(null, errorResponse(501, 'HeatIDs is null'))
      }

      //TODO: clean this up. there is a bunch of redundant loops being performed. Could be done more efficiently
      findEvent(eventID)
        .then(resultEvent => {
          //find runners and make sure that none of them belong to a heat that is about to be removed
          let runnersToFind = resultEvent.body.runners.map(runner => {
            const select = 'body.heat'
            return findRunner(eventID, runner._id, select)
          })

          Promise.all(runnersToFind)
            .then(foundRunnerHeats => {
              let eventHeats = {} //heats that runners currently belong to
              let validHeats = {}
              let invalidHeatIDs = []

              foundRunnerHeats.forEach(runner => {
                eventHeats[runner.body.heat] = 1
              })
              
              //sort valid heats from invalid heats
              heatIDs.forEach(id => {
                if(!validID(id)) {
                  invalidHeatIDs.push({
                    id,
                    errMessage: 'Invalid heat ID'
                  })
                }
                else if(!resultEvent.body.heats.hasOwnProperty(id)) {
                  invalidHeatIDs.push({
                    id,
                    errMessage: 'Heat not found in event'
                  })
                }
                else if(validHeats.hasOwnProperty(id)) {
                  invalidHeatIDs.push({
                    id,
                    errMessage: 'User submitted duplicate heat IDs'
                  })
                }
                else if(eventHeats.hasOwnProperty(id)) {
                  invalidHeatIDs.push({
                    id,
                    errMessage: 'Cannot remove a heat that still has runners associated with it'
                  })
                }
                else {
                  validHeats[id] = 1
                }
              })

              //escape early if there are no valid heats
              if(Object.keys(validHeats).length < 1) {
                const response = {
                  errMessage: 'No valid Heats to be removed',
                  invalidHeatIDs
                }
                return callback(null, errorResponse(501, response))
              }

              //newHeats object that will hold the existing heats, but remove the valid heats
              let newHeats = {}
              for(let heat in resultEvent.body.heats) {
                if(!validHeats.hasOwnProperty(heat)) {
                  newHeats[heat] = resultEvent.body.heats[heat]
                }
              }

              const conditions = { _id: eventID, type: 'event' }

              const updateValues = {
                lastModified: generateTimestamp(),
                'body.heats': newHeats
              }

              const options = { 
                new: true,
                lean: true 
              }

              //update the Event
              Data.findOneAndUpdate(conditions, updateValues, options)
                .then(updateResults => {
                  const response = {
                    'event': updateResults,
                    validHeats,
                    invalidHeatIDs
                  }
                  return callback(null, successResponse(200, response))
                })
                .catch(err => callback(null, errorResponse(err.statusCode, 'Error updating the event')))
            })
            .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding runners')))
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding the event')))
    })
}

module.exports.addCheckpoints = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID, checkpoints } = JSON.parse(event.body)

      if(!validID(eventID)) {
        return callback(null, errorResponse(501, 'Invalid event ID'))
      }
      if(!checkpoints) {
        return callback(null, errorResponse(501, 'Checkpoints not supplied'))
      }

      findEvent(eventID)
        .then(resultEvent => {
          let validCheckpoints = []
          let invalidCheckpoints = []
          let eventCheckpointNames = {} //existing checkpoint names
          let submittedCheckpointNames = {} //checkpoint names submitted by user

          //get a hash table of existing checkpoint names in the Event
          Object.keys(resultEvent.body.checkpoints).forEach(key => {
            eventCheckpointNames[resultEvent.body.checkpoints[key].name] = 1
          })

          //sort out valid checkpoints and invalid checkpoints
          checkpoints.forEach(checkpoint => {
            if(!validCheckpointFormat(checkpoint)) {
              invalidCheckpoints.push({
                checkpoint,
                errMessage: 'Invalid checkpoint format'
              })
            }
            else if(eventCheckpointNames.hasOwnProperty(checkpoint.name)) {
              invalidCheckpoints.push({
                checkpoint,
                errMessage: 'Checkpoint already exists in the event'
              })
            }
            else if(submittedCheckpointNames.hasOwnProperty(checkpoint.name)) {
              invalidCheckpoints.push({
                checkpoint,
                errMessage: 'User submitted checkpoint with duplicate name'
              })
            }
            else {
              validCheckpoints.push({
                name: checkpoint.name
              })
              submittedCheckpointNames[checkpoint.name] = 1
            }
          })

          //escape early if none of the checkpoints were valid
          if(validCheckpoints.length < 1) {
            const response = {
              errMessage: 'No valid checkpoints to add',
              invalidCheckpoints
            }
            return callback(null, errorResponse(500, response))
          }

          const formattedCheckpoints = validCheckpoints.map(checkpoint => {return generateCheckpoint(checkpoint)})
          
          //newCheckpoints object that will hold existing checkpoints + new valid checkpoints
          let newCheckpoints = {}
          for(let checkpoint in resultEvent.body.checkpoints) {
            newCheckpoints[checkpoint] = resultEvent.body.checkpoints[checkpoint]
          }
          formattedCheckpoints.forEach(checkpoint => {
            newCheckpoints[checkpoint._id] = {
              name: checkpoint.name
            }
          })

          const conditions = { _id: eventID, type: 'event' }

          const updateValues = {
            lastModified: generateTimestamp(),
            'body.checkpoints': newCheckpoints
          }

          const options = { 
            new: true,
            lean: true
          }

          //update the Event
          Data.findOneAndUpdate(conditions, updateValues, options)
            .then(updateResult => {
              const response = {
                event: updateResult,
                checkpoints: formattedCheckpoints,
                invalidCheckpoints
              }
              return callback(null, successResponse(200, response))
            })
            .catch(err => callback(errorResponse(err.statusCode, 'Error updating the event')))
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding the event')))
    })
}

//TODO: return the removed elements???
module.exports.removeCheckpoints = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID, checkpointIDs } = JSON.parse(event.body)
      if(!validID(eventID)) {
        return callback(null, errorResponse(501, 'Invalid eventID'))
      }
      if(checkpointIDs === null) {
        return callback(null, errorResponse(501, 'CheckpointIDs is null'))
      }

      findEvent(eventID)
        .then(resultEvent => {
          let validCheckpoints = {}
          let invalidCheckpointIDs = []

          //sort out valid checkpoints and invalid checkpoints
          checkpointIDs.forEach(id => {
            if(!validID(id)) {
              invalidCheckpointIDs.push({
                id,
                errMessage: 'Invalid checkpoint ID'
              })
            }
            else if(!resultEvent.body.checkpoints.hasOwnProperty(id)) {
              invalidCheckpointIDs.push({
                id,
                errMessage: 'Checkpoint not found in event'
              })
            }
            else if(validCheckpoints.hasOwnProperty(id)) {
              invalidCheckpointIDs.push({
                id,
                errMessage: 'User submitted duplicate checkpoint IDs'
              })
            }
            else {
              validCheckpoints[id] = 1
            }
          })

          //escape early if there are no valid checkpoints
          if(Object.keys(validCheckpoints).length < 1) {
            const response = {
              errMessage: 'No valid Checkpoints to be removed',
              invalidCheckpointIDs
            }
            return callback(null, errorResponse(501, response))
          }

          //newCheckpoints object that will hold existing checkpoints, but remove the valid checkpoints
          let newCheckpoints = {}
          for(let checkpoint in resultEvent.body.checkpoints) {
            if(!validCheckpoints.hasOwnProperty(checkpoint)) {
              newCheckpoints[checkpoint] = resultEvent.body.checkpoints[checkpoint]
            }
          }
          const conditions = { _id: eventID, type: 'event' }

          const updateValues = {
            lastModified: generateTimestamp(),
            'body.checkpoints': newCheckpoints
          }

          const options = { 
            new: true,
            lean: true 
          }

          //update the Event
          Data.findOneAndUpdate(conditions, updateValues, options)
            .then(updateResults => {
              const response = {
                'event': updateResults,
                invalidCheckpointIDs
              }
              return callback(null, successResponse(200, response))
            })
            .catch(err => callback(null, errorResponse(err.statusCode, 'Error updating the event')))
        })
        .catch(err => errorResponse(err.statusCode, 'Error finding the event'))
    })
}

/*
ROAD MAP for ADDSPLITS
-find event
for (runner in userInput)
  -validate 
    ->return validRunners
-find runners
for (runner in validRunners)
  for(split in validRunners.splits)
    -validate splits 
    -prep splits to be updated
      ->return update Query
run all of the update queries
*/

//This is the most difficult API call to read and debug. Find a better way!!!
//Way too convoluted -> try to simplify logic
//TODO check to see if heatTime starts before splitTime
module.exports.addSplits = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID, runners } = JSON.parse(event.body)

      if(!validID(eventID)) {
        return callback(null, errorResponse(501, 'Invalid event ID'))
      }

      findEvent(eventID)
        .then(resultEvent => {
          if(resultEvent == null) {
            return callback(null, errorResponse(400, 'Event does not exist'))
          }
          let invalidRunners = []
          let validRunners = {}

          if(resultEvent.body.runners.length < 1) {
            return callback(null, errorResponse(501, 'Event does not have any runners'))
          }
          let eventRunners = {}
          resultEvent.body.runners.forEach(runner => {
            eventRunners[runner._id] = 1
          })

          //verify runners
          runners.forEach(runner => {
            if(!validID(runner._id)) {
              invalidRunners.push({
                runner,
                errMessage: 'Invalid runner ID'
              })
            }
            else if(!resultEvent.body.heats.hasOwnProperty(runner.heatID)) {
              invalidRunners.push({
                runner,
                errMessage: 'Runners heat does not exist in the event'
              })
            }
            else if(!eventRunners.hasOwnProperty(runner._id)) {
              invalidRunners.push({
                runner,
                errMessage: 'Runner does not exist in event'
              })
            }
            else if(validRunners.hasOwnProperty(runner._id)) {
              invalidRunners.push({
                runner,
                errMessage: 'User submitted duplicate runners'
              })
            }
            else {
              validRunners[runner._id] = {
                lastModified: runner.lastModified,
                splits: runner.splits
              }
            }
          })

          //are there any verified runners? If not, return
          if(Object.keys(validRunners).length < 1) {
            const response = {
              invalidRunners,
              errMessage: 'No valid runners'
            }
            return callback(null, errorResponse(501, response))
          }

          //prepare to find the verfied runners
          let runnersToFind = Object.keys(validRunners).map(runnerID => {
            const select = '_id lastModified body.splits'
            return findRunner(eventID, runnerID, select)
          })

          //find verified runners
          Promise.all(runnersToFind)
            .then(foundRunners => {
              let invalidSplits = []
              let runnersToUpdate = []

              //verify the runners from user input matches the runner data from the database
              foundRunners.forEach(runner => {
                //NOTE: this shouldn't happen!
                //this would imply that the runner no longer exists, but the event still has its key
                //this should trigger the App to getEvent() to update
                if(runner === null) {
                  invalidRunners.push({
                    errMessage: 'Unable to find runner in database'
                  })
                }
                else if(runner.lastModified !== validRunners[runner._id].lastModified) {
                  invalidRunners.push({
                    runner,
                    errMessage: 'Runner has been modified by another user'
                  })
                }
                //sort out the valid splits from the invalid splits for this particular runner
                else {
                  let splitsToUpdate = {} //will contain all of the valid splits for this runner
                  
                  validRunners[runner._id].splits.forEach(key => {
                    if(!validID(key.checkpointID)) {
                      invalidSplits.push({
                        runner: runner._id,
                        split: key,
                        errMessage: 'Invalid split ID'
                      })
                    }
                    else if(!validSplitTime(key.splitTime)) {
                      invalidSplits.push({
                        runner: runner._id,
                        split: key,
                        errMessage: 'Invalid split time'
                      })
                    }
                    else if(runner.body.splits.hasOwnProperty(key.checkpointID)) {
                      invalidSplits.push({
                        runner,
                        split: key,
                        errMessage: 'A split already exists for that checkpoint'
                      })
                    }
                    else if(!resultEvent.body.checkpoints.hasOwnProperty(key.checkpointID)) {
                      invalidSplits.push({
                        runner,
                        split: key,
                        errMessage: 'Checkpoint does not exist in the event'
                      })
                    }
                    else {
                      splitsToUpdate[key.checkpointID] = key.splitTime
                    }
                  })

                  //put all of the valid splits in an object to update the database
                  if(Object.keys(splitsToUpdate).length > 0) {
                    const conditions = {
                      _id: runner._id
                    }
                    const updateValues = {
                      lastModified: generateTimestamp(),
                      'body.splits': {
                        ...runner.body.splits,
                        ...splitsToUpdate
                      }
                    }
                    const options = {
                      new: true
                    }

                    runnersToUpdate.push(
                      Data.findOneAndUpdate(conditions, updateValues, options)
                    )
                  }
                }
              })

              
              //if there are no valid splits to update, return
              if(runnersToUpdate.length < 1) {
                const response = {
                  invalidRunners,
                  invalidSplits,
                  errMessage: 'No valid splits to update'
                }
                return callback(null, errorResponse(501, response))
              }

              //update runners
              Promise.all(runnersToUpdate)
                .then(updateResults => {
                  const response = {
                    updatedRunners: updateResults,
                    invalidRunners,
                    invalidSplits
                  }
                  return callback(null, successResponse(200, response))
                })
                .catch(err => callback(null, errorResponse(err.statusCode, 'Error updating runners')))
            })
            .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding runners')))
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding event')))
    })
}

module.exports.startHeat = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      const { eventID, heatID, startTime } = JSON.parse(event.body)

      if(!validID(eventID)) {
        return callback(null, errorResponse(501, 'Invalid event ID'))
      }
      if(!validID(heatID)) {
        return callback(null, errorResponse(501, 'Invalid heat ID'))
      }
      if(!validSplitTime(startTime)) {
        return callback(null, errorResponse(501, 'Invalid start time'))
      }

      findEvent(eventID)
        .then(resultEvent => {
          
          if(resultEvent === null) {
            return callback(null, errorResponse(401, 'Event does not exist'))
          }
          if(!resultEvent.body.heats.hasOwnProperty(heatID)) {
            return callback(null, errorResponse(401, 'This heat does not exist in the event'))
          }
          if(resultEvent.body.heats[heatID].startTime !== null) {
            return callback(null, errorResponse(401, 'Heat has already started'))
          }
          
          const conditions = {
            _id: eventID
          }

          //TODO: is there a better way to update the single item without having to replace the entire object???
          const updateValues = {
            ...resultEvent,
            lastModified: generateTimestamp(),
            body: {
              ...resultEvent.body,
              heats: {
                ...resultEvent.body.heats,
                [heatID]: {
                  ...resultEvent.body.heats[heatID],
                  startTime
                }
              }
            }
          }

          const options = {
            new: true,
            lean: true
          }

          Data.findOneAndUpdate(conditions, updateValues, options)
            .then(updateResult => callback(null, successResponse(200, updateResult)))
            .catch(err => callback(null, errorResponse(err.statusCode, 'Error updating heat')))
        })
        .catch(err => callback(null, errorResponse(err.statusCode, 'Error finding event')))
    })
}

/*************** HELPER FUNCTIONS *******************/

//TODO: is '' a validString???
function validString (input) {
  const NOT_FOUND = -1
  if (typeof(input) !== 'string')
  {
    return false
  }
  //captures '' , undefined , null
  if (!input) {
    return false
  }
  if (input.indexOf('$') !== NOT_FOUND) {
    return false
  }
  return true
}

function validSplitTime(splitTime) {
  if(!validNumber) {
    return false
  }
  return true
}

function validNumber(input) {
  if(typeof(input) !== 'number') {
    return false
  }
  //captures NaN
  if(input !== input) {
    return false
  }
  return true
}

function formatUnitOfMeasure (input) {
  const UNITS = ['kilometers', 'meters', 'miles', 'feet']
  if(typeof(input) !== 'string') {
    return ''
  }
  if(!UNITS.includes(input)) {
    return ''
  }

  return input
}

function formatNumber (input) {
  if(input === null) {
    return input
  }
  
  let value = null
  if(typeof(input) !== 'number')
  {
    value = Number(input)
  }
  if(value !== value) {
    return null
  }
  return input
}

function validID (input) {
  /*if(typeof(input) !== 'string') {
    return false
  }

  const regex = /\W/
  return (!regex.test(input))*/
  return isValidObjectID(input)
}

function validHeatFormat (heat) {
  const { name } = heat

  if(!name) {
    return false
  }
  if(!validString(name)) {
    return false
  }
  return true
}

function validCheckpointFormat (checkpoint) {
  const { name } = checkpoint

  if(!name) {
    return false
  }
  if(!validString(name)) {
    return false
  }
  return true
}

function validRunnerFormat (runner) {
  const { name, bib, heat } = runner

  if (!validString(name)) {
    return false
  }
  if (!validString(bib)) {
    return false
  }
  if (!validString(heat)) {
    return false
  }
  return true
}

//TODO: validRunner (runner) {}
//compare against a runnerSchema
//needed for updateRunner() {} API

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
      splits: {}
    }
  }
  return newRunner
}

function generateEvent (event) {
  const { name, unitOfMeasure, totalDistance } = event

  return {
    _id: generateID(),
    type: 'event',
    lastModified: generateTimestamp(),
    body: {
      name,
      unitOfMeasure,
      totalDistance,
      checkpoints: {},
      heats: {},
      runners: []
    }
  }
}

function generateHeat (heat) {
  const { name } = heat

  return {
    _id: generateID(),
    name,
    startTime: null
  }
}

function generateCheckpoint (checkpoint) {
  const { name } = checkpoint

  return {
    _id: generateID(),
    name
  }
}

function errorResponse(statusCode, errorMessage) {
  return {
    statusCode: statusCode || 500,
    headers: { 'Context-Type': 'text/plain' },
    body: JSON.stringify(errorMessage) 
  }
}

function successResponse(statusCode, body) {
  return {
    statusCode: statusCode || 200,
    body: JSON.stringify(body)
  }
}

//TODO: should this eventually include the lastModified parameter???
//TODO: put the select as an input parameter (then fix all of the functions that call this)
//->findEvent(eventID, select)  --> then remove (const select...)
function findEvent(eventID) {
  const eventConditions = { _id: eventID, type: 'event' }
  const select = '_id type lastModified body'
  const options = { lean: true }

  return Data.findOne(eventConditions, select, options)
}

//TODO: should this eventually include the lastModified parameter???
//NOTE: nested ObjectId's need to be converted for the comparison to work!
function findRunner(eventID, runnerID, select) {
  const runnerConditions = { 
    _id: runnerID, 
    type: 'runner',
    'body.eventID': convertToObjectID(eventID)
  }

  const options = { lean: true }

  return Data.findOne(runnerConditions, select, options)
} 