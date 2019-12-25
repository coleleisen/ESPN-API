const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const conf = require('../conf.json');
const category = require('../models/category.js');
const team = require('../models/team.js');
const player = require('../models/player.js');
const league = require('../models/league.js');


const connectionString = `mongodb+srv://${conf.userDB}:${conf.passDB}@espn-cluster-ggfli.mongodb.net/ESPN?retryWrites=true&w=majority`;
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

    const connector = mongoose.connect(connectionString, {
      useNewUrlParser : true,
      useUnifiedTopology : true
  })
  
  mongoose.connection.on('connected', ()=>{
     console.log("connected to db");
     League = mongoose.model("League", league);
     Player = mongoose.model("Player", player);
     Team = mongoose.model("Team", team);
     Category = mongoose.model("Category", category);
  })
    //TO login through basketball page
    /*
    const url = 'https://www.espn.com/fantasy/basketball/'

    
        const page = await browser.newPage();

        await page.goto(url, {waitUntil: 'networkidle2'})

        await page.waitForSelector('a[id="global-user-trigger"]');
         await page.hover('a[id="global-user-trigger"]');
         await page.waitForSelector('ul[class="account-management"]');

           
       let data = await page.evaluate(()=>{   
            let login = document.querySelector('ul[class="account-management"] > li:nth-child(5) > a')
            let efaf = document.querySelector('a[class="button-alt med open-favs"]').innerText
            document.querySelector('ul[class="account-management"] > li:nth-child(5) > a').click();

            return { efaf, login}
          })
          console.log(data)
       
*/
//login the easier way
const url = 'https://www.espn.com/login'


const page = await browser.newPage();

//page.on('console', consoleObj => console.log(consoleObj.text())); //this line allows browser console to be shown in node console

 await page.goto(url, {waitUntil: 'networkidle2'})

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
      
        await page.waitForSelector('#fantasy-feed-items');
       let list = await page.evaluate((ESPNleague) => {
           let div = document.querySelector('#fantasy-feed-items');
           var divs = div.querySelectorAll('div[class="favItem favItem--fantasy"]');
           for (var i = 0; i < divs.length; i += 1) {   
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

     // await page.waitForNavigation({waitUntil : 'networkidle2'});
      console.log(list)
      let d = new Date();
      let leagueObj = {leagueName : list, lastUpdated : d, teams : []}
      var l = new League(leagueObj);
     
      await page.waitForSelector('li[class="standings NavSecondary__Item"]');
       await page.evaluate(() => {
            let div = document.querySelector('li[class="standings NavSecondary__Item"]');
            let btn = div.querySelector('a[class="NavSecondary__Link"]');
            btn.click();
      })
      await page.waitForNavigation({waitUntil : 'networkidle2'});
      await page.waitForSelector('tbody[class="Table2__tbody"]');
      
      
      
     let counter = await page.evaluate(() => {
      let diver = document.querySelector('div[class="jsx-1423235964 season--stats--table"] > section > table > tbody > tr > td > div > table > tbody');
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
         let diver = document.querySelector('div[class="jsx-1423235964 season--stats--table"] > section > table > tbody > tr > td > div > table > tbody');
         let arr = diver.querySelectorAll('tr');
          let btn = arr[j];
          let count = btn.innerText;
          let c = count.search("\t\n")
          let c0 = count.search("\n  ")
          let co = count.substring(c, c0);

          btn.querySelector('a').click();
         
         return count;
    },j)

    console.log(standings)
   
    
    await page.waitForNavigation({waitUntil : 'networkidle2'});
    await page.waitForSelector('table[class="Table2__table__wrapper"] > tbody');
    console.log(j);

    //click show 2020 stats!!
    await page.waitForSelector('#filterStat');
    await page.select('#filterStat', 'currSeason');

   let leagueCatAvg = leg;
   let oz= await page.evaluate((j, standings, leagueCatAvg) => {
      let playerTable = document.querySelector('div > table > tbody');
      let playerRows = playerTable.querySelectorAll('tr'); //all players on roster
      
      let catTable = document.querySelector('div[class="Table2__shadow-container"] > div > div > table');
      let catNumbers = catTable.querySelector('tbody > tr > td > div > table > tbody');
      let catRows = catNumbers.querySelectorAll('tr');   //all cat rows for each player
      let n = catRows.length;
      let nu = playerRows.length;
      let players = [];     
      let catName = [];
      let teamCatAvg = new Array(n).fill(0);
      let teamCatCount=0;
      for(var y = 0 ; y < nu; y += 1){
        if(y==0){ //if its first time around loop, collect cateogry names
          let cat = catTable.querySelector('thead[class="Table2__sub-header Table2__thead"] > tr');  //get category row names
            let catNames = cat.querySelectorAll('th');   
            for(var x = 0; x < catNames.length ; x+= 1){
                   let namer = catNames[x].querySelector('span').innerText;
                   catName.push(namer);
            }
         }
         
         let play = playerRows[y];
         let playerInfo = play.querySelectorAll('td');
         let playerPos = playerInfo[0].innerText;
         let playerName = playerInfo[1].querySelector('div').title;
      
          //check if player slot is empty
         if(playerName!="Player"){    
           let playerz = playerInfo[1].querySelector('div').innerHTML;
           let playerImg= playerz.search("http");
           let playerImgs = playerz.search(".png");
           let playerImgStr = playerz.substring(playerImg, playerImgs);
           playerImgStr += ".png";

         // let playerImgs = playerz.querySelectorAll('img');
         //let playerImg = playerImgs[0].src;
       
           let playerInj = false;
           if(playerPos==='IR'){
               playerInj = true;
           }

           let catNums = [];
           let cato = catRows[y];
           let catInfo = cato.querySelectorAll('td');
           for(var i =0 ; i < catInfo.length; i +=1){     
             
             let numb = catInfo[i].querySelector('div').innerText; 
             let nam = catName[i]; 
             
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
                let cat2 = {name : nam, number : num2}; 
                catNums.push(cat2);
                if(num1!="NaN" && typeof num1 !== 'string' && num1 != null && playerInj != true){
                  leagueCatAvg[i] += num1;
                  teamCatAvg[i] += num1;
                  teamCatCount++;
                  
                }
                if(num2!="NaN" && typeof num2 !== 'string' && num2 != null && playerInj != true){
                  leagueCatAvg[i+1] += num2;               
                  teamCatAvg[i+1] += num2;
                  teamCatCount++;
                }
                 if(num2!="NaN" && typeof num2 !== 'string' && num2 != null && playerInj != true && num1!="NaN" && typeof num1 !== 'string' && num1 != null){
                  i++;
                 }                           
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
                let cat2 = {name : nam, number : num2};
                catNums.push(cat2); 
                if(num1!="NaN" && typeof num1 !== 'string' && num1 != null && playerInj != true){
                  leagueCatAvg[i] += num1;
                  teamCatAvg[i] += num1;
                  teamCatCount++;
                 
                }
                if(num2!="NaN" && typeof num2 !== 'string' && num2 != null && playerInj != true){
                  leagueCatAvg[i+1] += num2;               
                  teamCatAvg[i+1] += num2;
                  teamCatCount++;
                }
                 if(num2!="NaN" && typeof num2 !== 'string' && num2 != null && playerInj != true && num1!="NaN" && typeof num1 !== 'string' && num1 != null){
                  i++;
                 } 
               }       
            } 
            else{
              
              let num = parseFloat(numb);
              if(num!="NaN" && typeof num !== 'string' && num != null && playerInj != true){
                numb = num;     
                leagueCatAvg[i] += num;  
                teamCatAvg[i] += num;             
                teamCatCount++;
              }  
               
              let cat = {name : nam, number : numb};             
              catNums.push(cat); 
             }  
            } //end of cat loop
            
           var player = {name : playerName, image : playerImgStr, position : playerPos, injured : playerInj,  categories : catNums};  
           players.push(player);
           
          }      
         
      }
       //end of player loop
       
       

      let obj = {
        teamName : standings,
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
        if(cat==="FTM"){      
          teamer.push({name : "FTA", number : oz.catAvg[i]})
          teamer.push({name : cat, number : oz.catAvg[i+1]}) 
          teamer.push({name : "FT%", number : oz.catAvg[i] / oz.catAvg[i+1]})
          i ++;
        }
        else
        if(cat==="FGM"){      
          teamer.push({name : "FGA", number : oz.catAvg[i]})
          teamer.push({name : cat, number : oz.catAvg[i+1]}) 
          teamer.push({name : "FG%", number : oz.catAvg[i] / oz.catAvg[i+1]})
          i ++;
        }
        else{
          teamer.push({name : cat, number : oz.catAvg[i]})
        }       
    }
    oz.catAvg = teamer;
    l.teams.push(oz);
   console.log(oz)

    
    //click standings page
    await page.waitForSelector('li[class="standings NavSecondary__Item"]');
    await page.evaluate(() => {
         let div = document.querySelector('li[class="standings NavSecondary__Item"]');
         let btn = div.querySelector('a[class="NavSecondary__Link"]');
         btn.click();
   })
   await page.waitForNavigation({waitUntil : 'networkidle2'});
   await page.waitForSelector('tbody[class="Table2__tbody"]');
    
   
   
    }//end of standings for loop
    let leaguer = [];
    for(var i =0 ; i < leag.length +2 ; i++){  //loop to format cat averages object
        let cat = cats[i]; 
        if(cat==="FTM"){      
          leaguer.push({name : "FTA", number : leag[i] / counter})
          leaguer.push({name : cat, number : leag[i+1] / counter}) 
          leaguer.push({name : "FT%", number : leag[i] / leag[i+1]})
          i ++;
        }
        else
        if(cat==="FGM"){      
          leaguer.push({name : "FGA", number : leag[i] / counter})
          leaguer.push({name : cat, number : leag[i+1] / counter}) 
          leaguer.push({name : "FG%", number : leag[i] / leag[i+1]})
          i ++;
        }
        else{
          leaguer.push({name : cat, number : leag[i] / counter})
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