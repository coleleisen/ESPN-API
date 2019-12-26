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

   
    
    
       League = mongoose.model("League", league);
       League.findOne({ 'leagueName': req.body.league }, function (err, leagueObj) {
        if (err){
            handleError(err);
            return res.status(500).json({ message: err, status : "fail"})
            
        } 
        else if(leagueObj==null){
           return res.status(200).json({
                message: "no league found with that name", status : "fail"
                })
            
        }
        else{
            console.log(leagueObj);
            
             return res.status(200).json(leagueObj);

             
        }      
      })

})

module.exports = router;