const connectToDatabase = require('./db')
const Data = require('./Data')
const Utils = require('./utils')
let generateID = Utils.generateID
let generateTimestamp = Utils.generateTimestamp

require('dotenv').config({ path: './variables.env'})
'use strict';

//TODO: I probably want to return the entire checkpoint under most circumstances in order to maintain
//integrity on the app side, but how do I avoid doing wasteful gets?


/*
  eventID: 2305,
  name: 'Sunny Hills Relay',
  numRunners: 15,
  numCheckpoints: 10,
  startTime: 1541581769928 
  */

//DONE
module.exports.createEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { name, numRunners, numCheckpoints, } = JSON.parse(event.body)
      //const id = 'event::' + generateID()
      const _id = generateID()
      if(typeof(numRunners !== 'number')) {
        numRunners = Number(numRunners)
      }
      if(typeof(numCheckpoints !== 'number')) {
        numCheckpoints = Number(numCheckpoints)
      }

      const newEvent = {
        _id,
        type: 'event',
        lastModified: generateTimestamp(),
        body: {
          name,
          numRunners,
          numCheckpoints,
          startTime: ''
        }
      }
      //console.log('newEvent', newEvent)

      Data.create(newEvent)
        .then(result => callback(null, {
          statusCode: 200,
          body: JSON.stringify(result)
        }))
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Content-type': 'text/plain' },
          body: 'Could not create event.'
        }))
    })
}

/*
1: {
        runnerID: 1201,
        runnerNumber: 1,
        split: '10:20',
        lastModified: 1540084649946,
      },
*/


//DONE
module.exports.createSplit = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { eventID, checkpoint, runnerNumber, split } = JSON.parse(event.body)
      //const id = 'split::' + generateID()
      const _id = generateID()
      if(typeof(checkpoint !== 'number')) {
        checkpoint = Number(checkpoint)
      }
      if(typeof(runnerNumber !== 'number')) {
        runnerNumber = Number(runnerNumber)
      }
      if(typeof(split !== 'number')) {
        split = Number(split)
      }

      let findEvent = () => (
        Data.find({_id: eventID}).exec()
      )

      let findSplit = () => {
        const conditions = {
          type: 'split',
          'body.eventID': eventID,
          'body.checkpoint': checkpoint,
          'body.runnerNumber': runnerNumber
        }

        return Data.find(conditions).exec()
      }

      //NOTE: the promise will return [[findEventObject], [findSplitObject]]
      Promise.all([
        findEvent(),
        findSplit()
      ])
      .then(results => {
        console.log('results', results)
        const resultEvent = results[0][0]
        const resultSplit = results[1][0]
        console.log('event', resultEvent)
        console.log('split', resultSplit)

        //case 1: event hasn't started yet
        if(!resultEvent.body.startTime) {
          callback(null, {
            statusCode: 400,
            body: JSON.stringify(resultEvent),
            msg: 'The event has not started yet.'
          })
        }

        //case 2: split already exists
        else if (resultSplit) {
          callback(null, {
            statusCode: 400,
            body: JSON.stringify(resultSplit),
            msg: 'A split already exists for this runner at this checkpoint.'
          })
        }

        //create the split
        else {
          const newSplit = {
            _id,
            type: 'split',
            lastModified: generateTimestamp(),
            body: {
              eventID, 
              checkpoint,
              runnerNumber,
              split
            }
          }
          Data.create(newSplit)
            .then(data => callback(null, {
              statusCode: 200,
              body: JSON.stringify(data)
            }))
            .catch(err => callback(null, {
              statusCode: err.statusCode || 500,
              headers: { 'Content-type': 'text/plain' },
              body: 'Could not create split.'
            }))
        }
      })
      .catch(err => callback(null, {
        statusCode: err.statusCode || 500,
        headers: { 'Content-type': 'text/plain' },
        body: 'Could not validate split.'
      }))
    })

      
}

//DONE
module.exports.getEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      Data.findById(event.pathParameters.id)
        .then(data => callback(null, {
          statusCode: 200,
          body: JSON.stringify(data)
        }))
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not fetch event.'
        }))
    })
}

//DONE
module.exports.getCheckpoint = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false
  
  connectToDatabase()
    .then(() => {
      const { eventID } = event.queryStringParameters
      const checkpoint = Number(event.queryStringParameters.checkpoint)
      //console.log('event', event)
      //console.log('eventID', eventID)
      //console.log('checkpoint', checkpoint)
      //console.log('typeof checkpoint', typeof(checkpoint))

      //NOTE: I think a better way to find is to pass it the following
      /*
        {
          type: 'split',
          'body.eventID': eventID,
          'body.checkpoint': checkpoint
        }
      */
      Data.find({
        $and: [
          {type: 'split'},
          {"body.eventID": eventID},
          {"body.checkpoint": checkpoint}
        ]
      })
        .then(data => callback(null, {
          statusCode: 200,
          body: JSON.stringify(data)
        }))
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not fetch checkpoint.' 
        }))
    })
}

//DONE
module.exports.startEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { startTime, eventID, lastModified } = JSON.parse(event.body)
      if(typeof(startTime) !== 'number'){
        startTime = Number(startTime)
      }
      if(typeof(lastModified) !== 'number'){
        lastModified = Number(lastModified)
      }

        Data.findOne({_id: eventID})
          .then(data => {
            const updateInfo = {
              lastModified: generateTimestamp(),
              body: {
                ...data.body,
                startTime
              }
            }
            //console.log('preparing to update, updateInfo is ->', updateInfo)

            //new: true returns the new updated document
            Data.findOneAndUpdate({_id: eventID}, updateInfo, {new: true})
              .then(updateData => callback(null, {
                statusCode: 200,
                body: JSON.stringify(updateData)
              }))
              .catch(err => callback(null, {
                statusCode: err.statusCode || 500,
                headers: { 'Context-Type': 'text/plain' },
                body: 'Could not update after start event.' 
              }))
          })
          .catch(err => callback(null, {
            statusCode: err.statusCode || 500,
            headers: { 'Context-Type': 'text/plain' },
            body: 'Could not find your event.' 
          }))
    })
}

//TODO: DONE
module.exports.restartEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      console.log('event', event)
      let { eventID, lastModified } = event.queryStringParameters
      if(typeof(lastModified) !== 'number'){
        lastModified = Number(lastModified)
      }
      const conditions = {
        _id: eventID,
        type: 'event',
        lastModified
      }

      Data.findOne(conditions)
        .then(data => {
          const updateInfo = {
            ...data,
            lastModified: generateTimestamp(),
            body: {
              ...data.body,
              startTime: ''
              
            }
          }

          //new: true returns the new updated document
          Data.findOneAndUpdate(conditions, updateInfo, {new: true})
            .then(updateData => {
              const deleteConditions = {
                type: 'split',
                'body.eventID': eventID
              }
              Data.deleteMany(deleteConditions)
                .then(deleteData => callback(null, {
                  statusCode: 200,
                  body: JSON.stringify(updateData)
                }))
                .catch(err => callback(null, {
                  statusCode: err.statusCode || 500,
                  headers: { 'Context-Type': 'text/plain' },
                  body: 'Could not delete splits after restartEvent.' 
                }))
            })
        })
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not restart event.' 
        }))
    })
}

//TODO: test
module.exports.updateSplit = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { id, split, lastModified } = JSON.parse(event.body)
      if(typeof(split) !== 'number'){
        split = Number(split)
      }
      if(typeof(lastModified) !== 'number'){
        lastModified = Number(lastModified)
      }
      
      const conditions = {
        _id: id,
        type: 'split',
        'body.lastModified': lastModified
      }

      Data.findOne(conditions)
        .then(data => {
          const updateInfo = {
            ...data,
            lastModified: generateTimestamp(),
            body: {
              ...data.body,
              split
            }
          }
          Data.findOneAndUpdate(conditions, updateInfo, {new: true})
            .then(updateData => callback(null, {
              statusCode: 200,
              body: JSON.stringify(updateData)
            }))
            .catch(err => callback(null, {
              statusCode: err.statusCode || 500,
              headers: { 'Context-Type': 'text/plain' },
              body: 'Could not update split. Resource probably modified during update request' 
            }))
        })
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not update split.' 
        }))
    })
}

//TODO: test
module.exports.deleteSplit = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { id, lastModified } = event.queryStringParameters
      if(typeof(lastModified) !== 'number'){
        lastModified = Number(lastModified)
      }
      const conditions = {
        _id: id,
        type: 'split',
        'body.lastModified': lastModified
      }
      console.log('lastModified is', lastModified)
      console.log('conditions', conditions)

      Data.findOneAndDelete(conditions)
        .then(data => callback(null, {
          statusCode: 200,
          body: JSON.stringify(data)
        }))
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not delete split.', 
        }))
    })
}

//TODO: test
module.exports.deleteEvent = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  connectToDatabase()
    .then(() => {
      let { eventID, lastModified } = event.queryStringParameters
      if(typeof(lastModified) !== 'number') {
        lastModified = Number(lastModified)
      }

      const conditions = {
        _id: eventID,
        type: 'event',
        lastModified
      }
      console.log(conditions)

      Data.findOneAndDelete(conditions)
        .then(data => {
          const deleteConditions = {
            type: 'split',
            'body.eventID': eventID
          }
          Data.deleteMany(deleteConditions)
            .then(deleteData => callback(null, {
              statusCode: 200,
              body: JSON.stringify(deleteData)
            }))
            .catch(err => callback(null, {
              statusCode: err.statusCode || 500,
              headers: { 'Context-Type': 'text/plain' },
              body: 'Could not delete splits after restartEvent.' 
            }))
        })
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not delete split.', 
        }))
    })
}

/*
splits: [
  {
    id,
    runnerNumber,
    split,
    lastModified
  },
  { }
]
*/

//TODO: test [deal with later]
//currently exploitable, fix first parameter of update()
module.exports.bulkUpdateSplits = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop

  connectToDatabase()
    .then(() => {
      const { eventID, checkpoint, splits } = JSON.parse(event.body)

      Data.update(
        {_id: {$in: splits.id}},
        {$set: {'body.lastModified': generateTimestamp(), split: splits.split}},
        {"multiple": true}
      ).then(data => callback(null, {
          statusCode: 200,
          body: JSON.stringify(data)
        }))
        .catch(err => callback(null, {
          statusCode: err.statusCode || 500,
          headers: { 'Context-Type': 'text/plain' },
          body: 'Could not bulk update splits.', 
        }))

    })
}

//DONE
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
