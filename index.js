const bodyParser = require('body-parser');
const ESPNroute = require('./routes/scrape');
const fetchRoute = require('./routes/fetch');
const morgan = require('morgan'); 
const http = require('http');
const https = require('https');
const express = require("express");
const app = express();
const mongoose = require('mongoose');
let cors = require('cors')
app.use(cors())

app.use(morgan('dev'));
require('dotenv').config();
// adds req.body
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


const connectionString = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@espn-cluster-ggfli.mongodb.net/ESPN\?retryWrites=true&w=majority`;

mongoose.connect(connectionString, {
  useNewUrlParser : true,
  useUnifiedTopology : true
})
mongoose.connection.on('connected', function() {
  console.log("connected to db")
})
// Handle CORS enabled 
app.use('/scrape', ESPNroute)
app.use('/fetch', fetchRoute)

/*
app.use((req, res, next) => {
  
 res.header('Access-Control-Allow-Origin', '*')
  //Could be list of allowed headers, here '*' means all headers
  res.header('Access-Control-Allow-Headers', '*')
 // res.header('Access-Control-Allow-Methods', '*')
  if (req.method === 'OPTIONS') {
      // Update to include all methods
      res.header('Access-Control-Allow-Methods', 'PUT, POST')
      // dont process further if options request and will res here
      return res.status(200).json({})
  }
  next();
})
*/


// Error request, 
app.use((req, res, next) => {
    const error = new Error('Route Not Found')
    error.status = 404;
    next(error)
})

// Catch all errors from all parts of the app
app.use((error, req, res, next) => {
    res.status(error.status || 500);
    res.json({
        error: {
            message: error.message
        }
    })
    return;
})


var HTTP_PORT = process.env.PORT || 3001;
//increase socket timeout time to deal with long response time of scrape
const httpServer = http.createServer(app, function (req, res) {
  res.socket.setTimeout(20 * 60 * 1000); // 20 minute timeout
  res.socket.once('timeout', function() {
  res.process.nextTick(res.socket.destroy);
});
  })   //make https if we get certificate
httpServer.listen(HTTP_PORT, () => {
  console.log("HTTP API Started on port: " + HTTP_PORT)
});

