const mongoose = require('mongoose')

const songSchema = mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    artist: {
        type: String,
        required: true
    },
    album: {
        type: String,
        required: true
    },
    category: {
        type: [String],
        enum: ['punjabi', 'gujrati']
    },
    likes: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user'
        }
    ],
    size: {
        type: Number,
        required: true
    },
    poster: {
        type: String,
        required: true
    },
    filename: {
        type: String,
        required: true
    }
});
module.exports = mongoose.model('song', songSchema)

