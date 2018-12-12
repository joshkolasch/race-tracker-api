const mongoose = require('mongoose')

//RT stands for Race-Tracker
const RTSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  type: String,
  lastModified: Number,
  body: mongoose.Schema.Types.Mixed
}, {minimize: false})

module.exports = mongoose.model('Data', RTSchema)