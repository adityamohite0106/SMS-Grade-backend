const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const Papa = require('papaparse');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Basic health check route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Student Grade Management API is running!',
    status: 'OK',
    mongoStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// MongoDB Connection with better error handling
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is not set!');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
})
  .then(() => {
    console.log('MongoDB connected successfully');
    console.log('Database Name:', mongoose.connection.name);
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    console.error('Connection string (masked):', MONGODB_URI.replace(/\/\/.*@/, '//***:***@'));
  });

// Student Schema
const studentSchema = new mongoose.Schema({
  student_id: {
    type: String,
    required: true,
    unique: true
  },
  student_name: {
    type: String,
    required: true
  },
  total_marks: {
    type: Number,
    required: true
  },
  marks_obtained: {
    type: Number,
    required: true
  },
  percentage: {
    type: Number,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

const Student = mongoose.model('Student', studentSchema);

// Upload History Schema
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

const UploadHistory = mongoose.model('UploadHistory', uploadHistorySchema);

// Multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-excel'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel and CSV files allowed.'));
    }
  }
});

// Process Excel File
function processExcelFile(buffer) {
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    return data.map(row => {
      const totalMarks = Number(row.Total_Marks || row.total_marks || row['Total Marks']);
      const marksObtained = Number(row.Marks_Obtained || row.marks_obtained || row['Marks Obtained']);
      
      return {
        student_id: String(row.Student_ID || row.student_id || row['Student ID']),
        student_name: String(row.Student_Name || row.student_name || row['Student Name']),
        total_marks: totalMarks,
        marks_obtained: marksObtained,
        percentage: Number((marksObtained / totalMarks * 100).toFixed(2))
      };
    });
  } catch (error) {
    console.error('Excel processing error:', error);
    throw new Error('Failed to process Excel file');
  }
}

// Process CSV File
function processCSVFile(buffer) {
  try {
    const csvData = buffer.toString();
    const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });
    
    return parsed.data.map(row => {
      const totalMarks = Number(row.Total_Marks || row.total_marks || row['Total Marks']);
      const marksObtained = Number(row.Marks_Obtained || row.marks_obtained || row['Marks Obtained']);
      
      return {
        student_id: String(row.Student_ID || row.student_id || row['Student ID']),
        student_name: String(row.Student_Name || row.student_name || row['Student Name']),
        total_marks: totalMarks,
        marks_obtained: marksObtained,
        percentage: Number((marksObtained / totalMarks * 100).toFixed(2))
      };
    });
  } catch (error) {
    console.error('CSV processing error:', error);
    throw new Error('Failed to process CSV file');
  }
}

// Routes

// Upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('Upload request received');
    
    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    let studentsData;
    
    if (req.file.mimetype.includes('sheet') || req.file.mimetype.includes('excel')) {
      studentsData = processExcelFile(req.file.buffer);
    } else if (req.file.mimetype.includes('csv')) {
      studentsData = processCSVFile(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    console.log('Processed students:', studentsData.length);

    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not connected');
    }

    // Save to database (replace existing data)
    await Student.deleteMany({});
    await Student.insertMany(studentsData);

    // Save upload history
    await UploadHistory.create({
      filename: req.file.originalname,
      file_type: req.file.mimetype.includes('csv') ? 'CSV' : 'Excel',
      students_count: studentsData.length,
      file_size: req.file.size,
      status: 'success'
    });

    console.log('Students saved to database and history recorded');

    res.json({ 
      message: 'File uploaded successfully', 
      count: studentsData.length,
      students: studentsData 
    });
  } catch (error) {
    console.error('Upload error:', error);
    
    // Save failed upload to history
    if (req.file) {
      try {
        await UploadHistory.create({
          filename: req.file.originalname,
          file_type: req.file.mimetype.includes('csv') ? 'CSV' : 'Excel',
          students_count: 0,
          file_size: req.file.size,
          status: 'error'
        });
      } catch (historyError) {
        console.error('Failed to save upload history:', historyError);
      }
    }
    
    res.status(500).json({ 
      error: 'Failed to process file',
      details: error.message 
    });
  }
});

// Get all students
app.get('/api/students', async (req, res) => {
  try {
    console.log('GET /api/students request received');
    
    if (mongoose.connection.readyState !== 1) {
      console.error('MongoDB not connected. ReadyState:', mongoose.connection.readyState);
      return res.status(500).json({ 
        error: 'Database connection error',
        mongoStatus: mongoose.connection.readyState 
      });
    }

    const students = await Student.find().sort({ created_at: -1 });
    console.log('Found students:', students.length);
    
    res.json(students);
  } catch (error) {
    console.error('Fetch students error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch students',
      details: error.message 
    });
  }
});

// Get upload history
app.get('/api/upload-history', async (req, res) => {
  try {
    console.log('GET /api/upload-history request received');
    
    if (mongoose.connection.readyState !== 1) {
      console.error('MongoDB not connected. ReadyState:', mongoose.connection.readyState);
      return res.status(500).json({ 
        error: 'Database connection error',
        mongoStatus: mongoose.connection.readyState 
      });
    }

    const history = await UploadHistory.find().sort({ upload_date: -1 }).limit(10);
    console.log('Found upload history:', history.length);
    
    res.json(history);
  } catch (error) {
    console.error('Fetch upload history error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch upload history',
      details: error.message 
    });
  }
});

// Update student
app.put('/api/students/:id', async (req, res) => {
  try {
    const { total_marks, marks_obtained } = req.body;
    const percentage = Number((marks_obtained / total_marks * 100).toFixed(2));
    
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { 
        ...req.body,
        percentage 
      },
      { new: true }
    );
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json(student);
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ 
      error: 'Failed to update student',
      details: error.message 
    });
  }
});

// Delete student
app.delete('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ 
      error: 'Failed to delete student',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: error.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('MongoDB URI set:', !!process.env.MONGODB_URI);
});
