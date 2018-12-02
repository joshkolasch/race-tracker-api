const mongoose = require('mongoose')

module.exports = 
{
  generateID: function () {
    return new mongoose.Types.ObjectId()
  },

   generateTimestamp: function () {
    return new Date().getTime()
  }
}