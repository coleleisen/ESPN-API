const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const league = require('../models/league.js');
require('dotenv').config();

console.log(process.env.DB_USER);
const connectionString = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@espn-cluster-ggfli.mongodb.net/ESPN?retryWrites=true&w=majority`;

router.post('/', (req, res, next)=>{
    console.log(process.env.DB_USER);
    console.log(typeof process.env.DB_USER);
    console.log(process.env.DB_PASS);
    if(!req.body.league){
        res.status(200).json({
            message: "must include league name", status : "fail"
            })
    }
    let League;

    var options = { server: { socketOptions: { keepAlive: 300000, connectTimeoutMS: 30000 } }, 
                replset: { socketOptions: { keepAlive: 300000, connectTimeoutMS : 30000 } } }; 

    const connector = mongoose.connect(connectionString, options, {
        useNewUrlParser : true,
        useUnifiedTopology : true
    })
    
    mongoose.connection.on('connected', ()=>{
       console.log("connected to db");
       League = mongoose.model("League", league);
       League.findOne({ 'leagueName': req.body.league }, function (err, leagueObj) {
        if (err){
            res.status(200).json({ message: err, status : "fail"})
            return handleError(err);
        } 
        if(leagueObj==null){
            res.status(200).json({
                message: "no league found with that name", status : "fail"
                })
        }
        else{
            console.log(leagueObj);
            res.status(200).json(leagueObj);
        }      
      })
    })

})

module.exports = router;