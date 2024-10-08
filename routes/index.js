var express = require('express');
var router = express.Router();
var users = require('../models/userModel');
var songModel = require('../models/songModel')

var playlistModel = require('../models/playlistModel')
const passport = require('passport');
var localStrategy = require('passport-local')
const mongoose = require('mongoose')
var multer = require('multer')
var id3 = require('node-id3')
const {Readable} = require('stream')
var crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const userModel = require('../models/userModel');

passport.use(new localStrategy(users.authenticate()))



mongoose.connect('mongodb://0.0.0.0/ar-N15').then(() =>{
  console.log('connected to database')
}).catch(err =>{
  console.log(err)
})


const conn = mongoose.connection

var gfsBucket, gfsBucketPoster
conn.once('open',() =>{
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db,{
    bucketName: 'audio'
  })
  gfsBucketPoster = new mongoose.mongo.GridFSBucket(conn.db,{
    bucketName: 'poster'
  })

})

 

router.post('/register', async (req, res, next) =>{
  var newUser = {
    username: req.body.username,
    email: req.body.email
  };
  users.register(newUser,req.body.password)
  .then((result) =>{
    passport.authenticate('local')(req, res,async() =>{


      const songs = await songModel.find()


      const defaultplaylist = await playlistModel.create({
        name: req.body.username,
        owner: req.user._id,
        songs: songs.map(song =>song._id)

      })

      console.log(songs.map(song=>song._id))

      const newUser = await userModel.findOne({
        _id: req.user._id
      })

      newUser.playlist.push(defaultplaylist._id)

      await newUser.save()
 



      res.redirect('/')
    });
  })

  .catch((err) =>{
    res.send(err);
  });
});


router.get('/auth',(req, res, next) =>{
  res.render('register')
})


router.post('/login', passport.authenticate('local',{
  successRedirect: '/',
  failureRedirect: '/login',
}) 
);

router.get('/logout', (req, res,next) =>{
  if (req.isAuthenticated())
  req.logout((err) =>{
    if(err) res.send(err);
    else res.redirect('/');
  });
  else{
    res.redirect('/')
  }
});


function isloggedIn(req, res, next){
  if(req.isAuthenticated()){
    return next();
  }
  else res.redirect('/auth');
}


function isAdmin(req, res, next){
  if(req.user.isAdmin)return next()
  else return res.redirect('/')
}


/* GET home page. */
router.get('/', isloggedIn, async function(req, res, next) {
  try {
      // Assume `currentSongFilename` is available in your server logic
      const currentSongFilename = "your_current_song_filename_here";

      // Fetch all songs from the database
      const allSongs = await songModel.find();

      // Fetch the current user's playlist with associated songs
      const currentUser = await userModel.findOne({ _id: req.user._id })
          .populate({
              path: 'playlist',
              populate: {
                  path: 'songs',
                  model: 'song'
              }
          });

      // Render the index page template with currentUser and allSongs
      res.render('index', { currentUser, allSongs, currentSongFilename: currentSongFilename });
  } catch (error) {
      console.error('Error fetching data:', error);
      res.status(500).send('An error occurred while fetching data');
  }
});



// Add this route to handle individual song playback
router.get('/playback', async function(req, res) {
  const currentUser = req.user ? await userModel.findOne({ _id: req.user._id }) : null;
  // Assuming you have a way to get the current user
  res.render('playback', { currentUser: currentUser });
});

   
  router.get('/play/:musicName', async (req, res, next) => {
    const currentSong = await songModel.findOne({
      filename: req.params.musicName
    });
  
    const allSongs = await songModel.find(); // Fetch all songs
    const remainingSongs = allSongs.filter(song => song.filename !== req.params.musicName); // Filter out the currently playing song
  
    res.render('playback', { 
      musicName: req.params.musicName,
      currentSong,
      remainingSongs,
      index: 0 // Assuming you have a way to determine the index for each song
    });
  });
  



// Export the router
module.exports = router;






router.get('/streem/:musicName', async (req, res, next) => {
  try {
      const currentSong = await songModel.findOne({
          filename: req.params.musicName
      });

      if (!currentSong) {
          return res.status(404).send('Song not found');
      }

      const stream = gfsBucket.openDownloadStreamByName(req.params.musicName);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', currentSong.size || 0); // Use 0 if size is null
      res.set('Content-Range', `bytes 0-${currentSong.size - 1 || 0}/${currentSong.size || 0}`);
      res.status(206);
      stream.pipe(res);
  } catch (error) {
      console.error('Error streaming song:', error);
      res.status(500).send('Error streaming song');
  }
});



router.get('/poster/:posterName', (req, res, next) => {
  try {
    const stream = gfsBucketPoster.openDownloadStreamByName(req.params.posterName);

    stream.on('error', (err) => {
      res.status(404).send('Poster not found');
    });

    stream.pipe(res);
  } catch (error) {
    console.error('Error fetching poster:', error);
    res.status(500).send('Internal server error');
  }
});





const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

router.post('/uploadMusic', isloggedIn, isAdmin, upload.array('song'), async (req, res, next) => {
  try {
      await Promise.all(req.files.map(async file => {
          const randomName = crypto.randomBytes(20).toString('hex');
          const songData = id3.read(file.buffer); // Fix here, use file.buffer instead of req.file.buffer
          const posterName = randomName + 'poster';
          
          // Upload song file
          const songReadStream = Readable.from(file.buffer);
          const songUploadStream = gfsBucket.openUploadStream(randomName);
          songReadStream.pipe(songUploadStream);

          // Upload poster
          if (songData && songData.image && songData.image.imageBuffer) {
              const posterReadStream = Readable.from(songData.image.imageBuffer);
              const posterUploadStream = gfsBucketPoster.openUploadStream(posterName);
              posterReadStream.pipe(posterUploadStream);
          }

          // Create song document in database
          await songModel.create({
              title: songData.title,
              artist: songData.artist,
              album: songData.album,
              size: file.size,
              poster: posterName,
              filename: randomName,
          });
      }));
      
      res.send('Songs uploaded successfully');
  } catch (err) {
      console.error('Error uploading songs:', err);
      res.status(500).send('Error uploading songs');
  }
});




router.get('/uploadMusic',isloggedIn,isAdmin,(req,res,next) =>{
  // console.log(req.user)
  res.render('uploadMusic')
})


router.get('/stream/:musicName', async (req, res) => {
  try {
      // Fetch the current song details from the database
      const currentSong = await songModel.findOne({ filename: req.params.musicName });

      if (!currentSong) {
          // Handle the case where the song is not found
          return res.status(404).send('Song not found');
      }

      // Stream the song from GridFS
      const stream = gfsBucket.openDownloadStreamByName(req.params.musicName);

      // Set appropriate headers for streaming
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', currentSong.size + 1);
      res.set('Content-Range', `bytes 0-${currentSong.size - 1}/${currentSong.size}`);
      res.set('Accept-Ranges', 'bytes');
      res.status(206);

      // Pipe the stream to the response
      stream.pipe(res);
  } catch (error) {
      console.error('Error streaming the song:', error);
      res.status(500).send('Internal server error');
  }
});


router.get('/search',(req,res,next) =>{
  res.render('search')
})


router.post('/search', async (req,res,next) =>{
  const searchedMusic = await songModel.find({
    title:{$regex: req.body.search}
  })
  res.json({
    songs: searchedMusic
  })
})


router.get('/songDetails', async (req, res, next) => {
  try {
      const { poster, title, artist, album, filename } = req.query;

      if (!poster || !title || !artist || !album || !filename) {
          return res.status(400).send('Missing song details');
      }

      const currentSong = await songModel.findOne({ filename });
      if (!currentSong) {
          return res.status(404).send('Song not found');
      }

      // Fetch all songs and filter out the currently playing song
      const allSongs = await songModel.find();
      const remainingSongs = allSongs.filter(song => song.filename !== filename);

      res.render('songDetails', {
          song: {
              poster: poster,
              title: title,
              artist: artist,
              album: album,
              filename: filename
          },
          remainingSongs: remainingSongs
      });
  } catch (error) {
      console.error('Error fetching song details:', error);
      res.status(500).send('Internal server error');
  }
});










module.exports = router;
