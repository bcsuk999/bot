require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const userRouter = require('./routes/user');
const adminRouter = require('./routes/admin');
const connectDB = require('./db/conn');

const app = express();
app.use(express.json());

connectDB();

app.use('/api/user', userRouter);
app.use('/api/admin', adminRouter);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});