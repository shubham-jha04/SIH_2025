const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
    email:{type:String,required:true,unique:true},
    password:{type:String,required:true}
});

module.exports = mongoose.model('HMPI_LOG_SIGN',LogSchema);