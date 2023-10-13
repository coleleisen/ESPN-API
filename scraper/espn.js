const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const category = require('../models/category.js');
const team = require('../models/team.js');
const player = require('../models/player.js');
const league = require('../models/league.js');
require('dotenv').config();

let League;
let Player;
let Team;
let Category;



async function scrapeESPN(ESPNuser, ESPNpass, ESPNleague){
    const browser = await puppeteer.launch({
        args: ['--disable-features=site-per-process'],  
        headless : false, //opens instance of chromeum
        defaultViewport : null //fixes view issue
    });

  
  
     League = mongoose.model("League", league);
     Player = mongoose.model("Player", player);
     Team = mongoose.model("Team", team);
     Category = mongoose.model("Category", category);
  
    //TO login through basketball page
    
    const url = 'https://www.espn.com/fantasy/basketball/'

    
        const page = await browser.newPage();

        await page.goto(url, {waitUntil: 'networkidle2'})

        await page.waitForSelector('a[id="global-user-trigger"]');
         await page.hover('a[id="global-user-trigger"]');
         await page.waitForSelector('ul[class="account-management"]');
           
       let data = await page.evaluate(()=>{ 
            
            document.querySelector('ul[class="account-management"] > li:nth-child(8) > a').click();
            return { }
          })
          console.log(data)
       

//login the easier way
/*
const url = 'https://www.espn.com/login'


const page = await browser.newPage();

//page.on('console', consoleObj => console.log(consoleObj.text())); //this line allows browser console to be shown in node console

 await page.goto(url, {waitUntil: 'networkidle2'})
*/
 function waitForFrame(page) {
  let fulfill;
  const promise = new Promise(x => fulfill = x);
  checkFrame();
  return promise;

  function checkFrame() {
    const frame = page.frames().find(f => f.name() === 'disneyid-iframe');
    if (frame)
      fulfill(frame);
    else
      page.once('frameattached', checkFrame);
      
  }
}
          /*
         page.setDefaultTimeout(60000)
         
         await page.waitForSelector("iframe");
         const elementHandle = await page.$('div#disneyid-wrapper iframe');      
         const frame = await waitForFrame(page);
         await frame.waitForSelector('[ng-model="vm.username"]');
          const username = await frame.$('[ng-model="vm.username"]');
          await username.type(ESPNuser, {delay : 30});

          await frame.waitForSelector('[ng-model="vm.password"]');
          const password = await frame.$('[ng-model="vm.password"]');
          await password.type(ESPNpass, {delay : 50});
        
          await frame.waitForSelector('[aria-label="Log In"]');
		      const loginButton = await frame.$('[aria-label="Log In"]');
	       	await loginButton.click();
        
           //check if login was failed.
        await page.waitForNavigation({waitUntil : 'networkidle2'});
        */
        console.log('hereye')
        page.setDefaultTimeout(60000)
        console.log('heretest')
        await page.waitForSelector('input');
        console.log(ESPNuser)
          const username = await page.$('input');
          await username.type(ESPNuser, {delay : 30});
          console.log('hereya')
          await page.waitForSelector('input');
          console.log(ESPNuser)
          const pass = await page.$('input');
          await pass.type(ESPNpass, {delay : 30});
        /*
        //UNCOMMENT WHEN FANTASY BUTTONS ARE BACK AFTER WORLD CUP
        await page.waitForSelector('#fantasy-feed-items');
       let list = await page.evaluate((ESPNleague) => {
       
           let div = document.querySelector('#fantasy-feed-items');
           var divs = div.querySelectorAll('div[class="favItem favItem--fantasy loaded"]');

           for (var i = 0; i < divs.length; i += 1) {   
            console.log("herooo")
             console.log(i)
               let diver = divs[i].querySelector('a[class="favItem__team"]'); 
               let text = diver.querySelector('div[class="favItem__subHead"]').innerText;
               if(text===ESPNleague){
                   diver.click();
                   return text;
                }       
           }
           //send failure message
           browser.close();
           return "No league found with that name"
       
      }, ESPNleague)
      */
      

      await page.goto("https://fantasy.espn.com/basketball/team?leagueId=63980886", {waitUntil: 'networkidle2'})
     // await page.waitForNavigation({waitUntil : 'networkidle2'});
      //console.log(list)
      let d = new Date();
      console.log(d)
      //let leagueObj = {leagueName : list, lastUpdated : d.toString(), teams : []}
      let leagueObj = {leagueName : "DGFBL", lastUpdated : d.toString(), teams : []}
      var l = new League(leagueObj);
     
      await page.waitForSelector('li[class="standings NavSecondary__Item"]');
       await page.evaluate(() => {
            let div = document.querySelector('li[class="standings NavSecondary__Item"]');
            let btn = div.querySelector('a[class="AnchorLink NavSecondary__Link"]');
            btn.click();
      })
      await page.waitForNavigation({waitUntil : 'networkidle2'});
      await page.waitForSelector('tbody[class="Table__TBODY"]');
      
      
     let counter = await page.evaluate(() => {
      let diver = document.querySelector('div[class="jsx-2972152035 season--stats--table"] >  div > div[class="flex"] > table > tbody');
       let arr = Array.from(diver.querySelectorAll('tr'));  
       let count = arr.length;
       return count;
  })  
    console.log(counter)
       
    let leag;
    let cats;
    let leg = new Array(20).fill(0); 
    for (var j = 0 ; j < counter ; j += 1){
        let standings = await page.evaluate((j) => {
         let diver = document.querySelector('div[class="jsx-2972152035 season--stats--table"] > div > div[class="flex"] > table > tbody');
         let arr = diver.querySelectorAll('tr');
          let btn = arr[j];
          let imger = btn.querySelector('img').src
          let count = {name : btn.innerText,img : imger};
          
          btn.querySelector('a').click();
         console.log(count)
         return count;
    },j)

    console.log(standings)
   
    
    await page.waitForNavigation({waitUntil : 'networkidle2'});
    await page.waitForSelector('table[class="Table Table--align-right Table--fixed Table--fixed-left"] > tbody');
    console.log(j);

    //click show 2020 stats!!
    await page.waitForSelector('#filterStat');
    //await page.select('#filterStat', 'lastSeason');
    await page.select('#filterStat', 'projections');
    //await page.select('#filterStat', 'currSeason');
    //await page.select('#filterStat', 'last30')
   let leagueCatAvg = leg;
   let oz= await page.evaluate((j, standings, leagueCatAvg) => {
      let playerTable = document.querySelector('div > table > tbody');
      let playerRows = playerTable.querySelectorAll('tr'); //all players on roster
      let catTable = document.querySelector('div[class="Table__ScrollerWrapper relative overflow-hidden"] > div[class="Table__Scroller"] > table > tbody');
      let catRows = catTable.querySelectorAll('tr');   //all cat rows for each player
      let n = catRows.length;
      let nu = playerRows.length;
      let players = [];     
      let catName = [];
      let teamCatAvg = new Array(n).fill(0);
      let teamCatCount=0;
      for(var y = 0 ; y < nu; y += 1){
        if(y==0){ //if its first time around loop, collect cateogry names
          let cat = document.querySelector('div[class="Table__ScrollerWrapper relative overflow-hidden"] > div[class="Table__Scroller"] > table > thead > tr[class="Table__sub-header Table__TR Table__even"]');  //get category row names
            let catNames = cat.querySelectorAll('th');   
            for(var x = 0; x < catNames.length ; x+= 1){
                   let namer = catNames[x].querySelector('span').innerText;
                   catName.push(namer);
            }
         }
         
         let play = playerRows[y];
         let playerInfo = play.querySelectorAll('td');
         let playerPos = playerInfo[0].innerText;
         let playerName = playerInfo[1].querySelector('div');
      
          //check if player slot is empty
        
         

         // let playerImgs = playerz.querySelectorAll('img');
         //let playerImg = playerImgs[0].src;
           let playerInj = false;
           if(playerPos==='IR'){
               playerInj = true;
           }
           if(playerName.title!="Player" && playerName.hasAttribute("title")){  

            let playerz = playerInfo[1].querySelector('div').innerHTML;
            let playerImg= playerz.search("http");
            let playerImgs = playerz.search(".png");
            let playerImgStr = playerz.substring(playerImg, playerImgs);
            playerImgStr += ".png";

           let catNums = [];
           console.log(playerName.title)
           console.log(playerImgStr)
           let cato = catRows[y];
           let catInfo = cato.querySelectorAll('td');
           for(var i =0 ; i < catInfo.length; i +=1){     
             
             let numb = catInfo[i].querySelector('div').innerText; 
             let nam = catName[i]; 
             if(nam==="PR15"){
               break;
             }
             if(nam==="FGM" || nam==="FTM"){
               if(nam==="FGM"){
                 //seperate by slash
                let slash = numb.search("/");
                let num1 = numb.substr(0, slash);
                let num2 = numb.substr(slash + 1, numb.length -1 );
                num1 = parseFloat(num1)
                num2 = parseFloat(num2)
                let cat = {name : "FGA", number : num1};             
                catNums.push(cat); 
                let cat2 = {name : "FGM", number : num2}; 
                catNums.push(cat2);
                let n = num1/num2;
                n = n.toFixed(3);
                n = parseFloat(n);
                let cat3 = {name : "FG%", number : n}
                catNums.push(cat3)
                if(num1!="NaN" && typeof num1 !== 'string' && num1 != null && playerInj != true && numb !="--/--"){
                  leagueCatAvg[i] += num1;
                  teamCatAvg[i] += num1;
                  teamCatCount++;
                  
                }
                if(num2!="NaN" && typeof num2 !== 'string' && num2 != null && playerInj != true && numb !="--/--"){
                  leagueCatAvg[i+1] += num2;               
                  teamCatAvg[i+1] += num2;
                  teamCatCount++;
                }
                i++;                         
               }
               if(nam==="FTM"){
                   //seperate by slash
                   let slash = numb.search("/");
                   let num1 = numb.substr(0, slash);
                   let num2 = numb.substr(slash + 1, numb.length -1 );
                   num1 = parseFloat(num1)
                   num2 = parseFloat(num2)                 
                let cat = {name : "FTA", number : num1};             
                catNums.push(cat); 
                let cat2 = {name : "FTM", number : num2};
                catNums.push(cat2); 
                let n = num1/num2;
                n = n.toFixed(3);
                n = parseFloat(n);
                let cat3 = {name : "FT%", number : n}
                catNums.push(cat3)
                if(num1!="NaN" && typeof num1 !== 'string' && num1 != null && playerInj != true && numb !="--/--"){
                  leagueCatAvg[i] += num1;
                  teamCatAvg[i] += num1;
                  teamCatCount++;
                 
                }
                if(num2!="NaN" && typeof num2 !== 'string' && num2 != null && playerInj != true && numb !="--/--"){
                  leagueCatAvg[i+1] += num2;               
                  teamCatAvg[i+1] += num2;
                  teamCatCount++;
                }
                i++;
                 
               }       
            } 
            else{       
              let num = parseFloat(numb);
              if(num!="NaN" && typeof num !== 'string' && num != null && playerInj != true && numb != '--'){
                numb = num;     
                leagueCatAvg[i] += num;  
                teamCatAvg[i] += num;             
                teamCatCount++;
              }  
               
              let cat = {name : nam, number : numb};             
              catNums.push(cat); 
             }  
            } //end of cat loop
              
           var player = {name : playerName.title, image : playerImgStr, position : playerPos, injured : playerInj,  categories : catNums};  
           players.push(player);
           
          }      
         
      }
       //end of player loop
       
       

      let obj = {
        teamName : standings.name,
        logo : standings.img,
        catAvg : teamCatAvg,
        players : players,
        league : leagueCatAvg,
        cats : catName
      }

      return obj;
      
 },j, standings, leagueCatAvg)
    
    cats = oz.cats;  //pass things through the evaluate function scope and then delete them to push object to mongo schema
    leag = oz.league;
    delete oz.league;
    delete oz.cats; 
    leg = leag;
   
    let teamer = [];
    for(var i =0 ; i < cats.length+2 ; i++){  //loop to format cat averages object
        let cat = cats[i]; 
        if(oz.catAvg[i] && cat){
        if(cat==="FTM"){      
          let g = oz.catAvg[i];  
          g = g.toFixed(1);
          g = parseFloat(g);
          let g2 = oz.catAvg[i+1];
          g2 = g2.toFixed(1);
          g2 = parseFloat(g2);
          teamer.push({name : "FTA", number : g})
          teamer.push({name : cat, number : g2}) 
          let g3 = g / g2;
          g3 = g3.toFixed(3)
          g3 = parseFloat(g3)
          teamer.push({name : "FT%", number : g3})
          i ++;
        }
        else
        if(cat==="FGM"){      
          let g = oz.catAvg[i];  
          g = g.toFixed(1);
          g = parseFloat(g);
          let g2 = oz.catAvg[i+1];
          g2 = g2.toFixed(1);
          g2 = parseFloat(g2);
          teamer.push({name : "FGA", number : g})
          teamer.push({name : cat, number : g2}) 
          let g3 = g / g2;
          g3 = g3.toFixed(3)
          g3 = parseFloat(g3)
          teamer.push({name : "FG%", number : g3})
          i ++;
        }
        else{
          let g = oz.catAvg[i];  
          g = g.toFixed(1);
          g = parseFloat(g);
          teamer.push({name : cat, number : g})
        }   
      }    
    }
    oz.catAvg = teamer;
    l.teams.push(oz);
   console.log(oz)

    
    //click standings page
    await page.waitForSelector('li[class="standings NavSecondary__Item"]');
    await page.evaluate(() => {
         let div = document.querySelector('li[class="standings NavSecondary__Item"]');
         let btn = div.querySelector('a[class="AnchorLink NavSecondary__Link"]');
         btn.click();
   })
   await page.waitForNavigation({waitUntil : 'networkidle2'});
   await page.waitForSelector('tbody[class="Table__TBODY"]');
    
   
    }//end of standings for loop
    let leaguer = [];
    for(var i =0 ; i < leag.length +2 ; i++){  //loop to format cat averages object
        let cat = cats[i];
        if(leag[i]){
 
        if(cat==="FTM"){    
          let g = leag[i] / counter;  
          g = g.toFixed(1);
          g = parseFloat(g);
          let g2 = leag[i+1] /counter;
          g2 = g2.toFixed(1);
          g2 = parseFloat(g2);
          leaguer.push({name : "FTA", number : g})
          leaguer.push({name : cat, number : g2}) 
          let g3 = g / g2;
          g3 = g3.toFixed(3)
          g3 = parseFloat(g3)
          leaguer.push({name : "FT%", number : g3})
          i ++;
        }
        else
        if(cat==="FGM"){      
          let g = leag[i] / counter;  
          g = g.toFixed(1);
          g = parseFloat(g);
          let g2 = leag[i+1] /counter;
          g2 = g2.toFixed(1);
          g2 = parseFloat(g2);
          leaguer.push({name : "FGA", number : g})
          leaguer.push({name : cat, number : g2}) 
          let g3 = g / g2;
          g3 = g3.toFixed(3)
          g3 = parseFloat(g3)
          leaguer.push({name : "FG%", number : g3})
          i ++;
        }
        else{
          let g = leag[i] / counter;  
          g = g.toFixed(1);
          g = parseFloat(g);
          leaguer.push({name : cat, number : g})
        }
      }
       
    }
    console.log(leaguer);
    l.catAvg = leaguer;
    await l.save(function (err) {
        if (!err) console.log('Success!');
        else console.log("failure saving to db");
      });
    
    browser.close();
}


module.exports = {
    scrape: scrapeESPN 
}