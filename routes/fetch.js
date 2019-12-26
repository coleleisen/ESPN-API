const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const league = require('../models/league.js');
require('dotenv').config();


const connectionString = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@espn-cluster-ggfli.mongodb.net/ESPN?retryWrites=true&w=majority`;

router.post('/', (req, res, next)=>{
    
    if(!req.body.league){
        res.status(200).json({
            message: "must include league name", status : "fail"
            })
            return;
    }
    let League;

   

    const connector = mongoose.connect(connectionString, {
        useNewUrlParser : true,
        useUnifiedTopology : true
    })
    
    mongoose.connection.on('connected', ()=>{
       console.log("connected to db");
       League = mongoose.model("League", league);
       League.findOne({ 'leagueName': req.body.league }, function (err, leagueObj) {
        if (err){
            handleError(err);
            res.status(200).json({ message: err, status : "fail"})
            return;
            
        } 
        else{
            console.log(leagueObj);
             res.status(200).json(leagueObj);
             return;
        }      
      })
    })

})

module.exports = router;