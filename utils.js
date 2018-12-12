const mongoose = require('mongoose')

module.exports = 
{
  generateID: function () {
    return new mongoose.Types.ObjectId()
  },

   generateTimestamp: function () {
    return new Date().getTime()
  },

  isValidObjectID: function (id) {
    return mongoose.Types.ObjectId.isValid(id)
  }
}