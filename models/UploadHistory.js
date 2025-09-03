const mongoose = require('mongoose');

const uploadHistorySchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  file_type: {
    type: String,
    required: true
  },
  students_count: {
    type: Number,
    required: true
  },
  upload_date: {
    type: Date,
    default: Date.now
  },
  file_size: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['success', 'error'],
    default: 'success'
  }
});

module.exports = mongoose.model('UploadHistory', uploadHistorySchema);