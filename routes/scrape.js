const espn = require("../scraper/espn.js");
const express = require('express');
const router = express.Router();

router.post('/', (req, res, next)=>{
    if(!req.body.username){
        res.status(200).json({
            message: "must include username", status : "fail"
            })
    }
    else
    if(!req.body.password){
        res.status(200).json({
            message: "must include password", status : "fail"
            })
    }
    else
    if(!req.body.league){
        res.status(200).json({
            message: "must include league", status : "fail"
            })
    }
else{


(async()=>{    
        await espn.scrape(req.body.username, req.body.password, req.body.league);
   })()
   .catch(console.error, ()=>{
    let resp = JSON.parse('{ "status": "fail", "message": "error scraping" }')
   res.status(500).json(resp)
   })
   .then(()=> {
   console.log("noice");
   let resp = JSON.parse('{ "status": "success", "message": "completed scrape and placed in db" }')
   res.status(200).json(resp)
   });
}
})

module.exports = router;