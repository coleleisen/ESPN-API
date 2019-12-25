const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const league = require('../models/league.js');

console.log(process.env)
const connectionString = `mongodb+srv://${process.env.dbUser}:${process.env.dbPass}@espn-cluster-ggfli.mongodb.net/ESPN?retryWrites=true&w=majority`;

router.post('/', (req, res, next)=>{
    if(!req.body.league){
        res.status(200).json({
            message: "must include league name", status : "fail"
            })
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