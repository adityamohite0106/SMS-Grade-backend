const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const Papa = require('papaparse');
require('dotenv').config();

const Student = require('./models/Student');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
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
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);
  
  return data.map(row => ({
    student_id: row.Student_ID || row.student_id,
    student_name: row.Student_Name || row.student_name,
    total_marks: Number(row.Total_Marks || row.total_marks),
    marks_obtained: Number(row.Marks_Obtained || row.marks_obtained),
    percentage: Number(((row.Marks_Obtained || row.marks_obtained) / (row.Total_Marks || row.total_marks) * 100).toFixed(2))
  }));
}

// Process CSV File
function processCSVFile(buffer) {
  const csvData = buffer.toString();
  const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });
  
  return parsed.data.map(row => ({
    student_id: row.Student_ID || row.student_id,
    student_name: row.Student_Name || row.student_name,
    total_marks: Number(row.Total_Marks || row.total_marks),
    marks_obtained: Number(row.Marks_Obtained || row.marks_obtained),
    percentage: Number(((row.Marks_Obtained || row.marks_obtained) / (row.Total_Marks || row.total_marks) * 100).toFixed(2))
  }));
}

// Routes

// Upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let studentsData;
    
    if (req.file.mimetype.includes('sheet') || req.file.mimetype.includes('excel')) {
      studentsData = processExcelFile(req.file.buffer);
    } else if (req.file.mimetype.includes('csv')) {
      studentsData = processCSVFile(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // Save to database (replace existing data)
    await Student.deleteMany({});
    await Student.insertMany(studentsData);

    res.json({ 
      message: 'File uploaded successfully', 
      count: studentsData.length,
      students: studentsData 
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// Get all students
app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find().sort({ created_at: -1 });
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
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
    
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Delete student
app.delete('/api/students/:id', async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});