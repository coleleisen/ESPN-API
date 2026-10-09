const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const league = require('../models/league.js');
require('dotenv').config();



router.post('/', (req, res, next)=>{

    if(typeof req.body.league !== 'string' || !req.body.league.trim()){
        res.status(200).json({
            message: "must include league name", status : "fail"
            })
            return;
    }
    let League;

       League = mongoose.model("League", league);
       League.findOne({ 'leagueName': req.body.league.trim() }, function (err, leagueObj) {
        if (err){
            return res.status(500).json({ message: 'Unable to load the league. Please try again.', status : "fail"})

        }
        else if(leagueObj==null){
           return res.status(200).json({
                message: "no league found with that name", status : "fail"
                })

        }
        else{
             return res.status(200).json(leagueObj);


        }
      })

})

module.exports = router;
