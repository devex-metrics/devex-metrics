export function getJS(): string {
  return `
var charts={};
var reposVisibility=[true,true];
var cssColors={};
var selectedRepos=new Set();
document.addEventListener("DOMContentLoaded",function(){
  var cs=getComputedStyle(document.documentElement);
  var cv=function(v){return cs.getPropertyValue(v).trim();};
  cssColors={warn:cv("--warn"),ok:cv("--ok"),accent:cv("--accent"),
    accentS:cv("--accent-s"),okS:cv("--ok-s"),warnS:cv("--warn-s"),
    err:cv("--err"),errS:cv("--err-s"),muted:cv("--muted"),border:cv("--border"),
    purple:cv("--purple")||"#8250df"};
  if(typeof Chart!=="undefined"){renderCharts();}
  setupGroups();
  setupControls();
  setupSortHeaders();
  setupFilter();
  setupRepoPicker();
  formatLineNumbers();
  applyFilter("30days");
});
function formatLineNumbers(){
  document.querySelectorAll(".td-lines .add,.td-lines .del").forEach(function(el){
    var t=el.textContent||"";
    var sign=t.charAt(0);
    var n=parseInt(t.slice(1),10);
    if(!isNaN(n))el.textContent=sign+n.toLocaleString();
  });
}
function renderCharts(){
  function hexToRgba(hex,a){
    var h=(hex||"").replace("#","");
    if(h.length===3)h=h.split("").map(function(c){return c+c;}).join("");
    var r=parseInt(h.slice(0,2),16)||0, g=parseInt(h.slice(2,4),16)||0, b=parseInt(h.slice(4,6),16)||0;
    return "rgba("+r+","+g+","+b+","+a+")";
  }
  Chart.register({id:"repoBarGrad",beforeUpdate:function(chart){
    if(chart.canvas.id!=="chartRepos")return;
    var ctx=chart.ctx,ca=chart.chartArea;
    if(!ca)return;
    chart.data.datasets.forEach(function(ds){
      var base=ds._gradBase;if(!base)return;
      // vertical gradient across the bar height for better contrast in narrow widths
      var g=ctx.createLinearGradient(0,ca.top,0,ca.bottom);
      g.addColorStop(0,hexToRgba(base,0.95));
      g.addColorStop(0.6,hexToRgba(base,0.85));
      g.addColorStop(1,hexToRgba(base,0.72));
      ds.backgroundColor=g;
      // subtle border to improve separation from background
      ds.borderColor=hexToRgba(base,0.9);
      ds.borderWidth=0;
    });
  }});
  Chart.defaults.color=cssColors.muted;
  Chart.defaults.plugins.legend.labels.usePointStyle=true;
  Chart.defaults.plugins.legend.labels.padding=16;
  var dOpts={cutout:"62%",plugins:{legend:{position:"bottom"}},responsive:true,maintainAspectRatio:true};
  charts.issues=new Chart(document.getElementById("chartIssues"),{type:"doughnut",
    data:{labels:["Open","Closed"],datasets:[{data:[CHART_DATA.issues.open,CHART_DATA.issues.closed],
      backgroundColor:[cssColors.warn,cssColors.ok],borderWidth:0,hoverOffset:6}]},options:dOpts});
  charts.prs=new Chart(document.getElementById("chartPRs"),{type:"doughnut",
    data:{labels:["Open","Merged","Closed"],datasets:[{data:[CHART_DATA.prs.open,CHART_DATA.prs.merged,CHART_DATA.prs.closed],
      backgroundColor:[cssColors.accent,cssColors.ok,cssColors.muted],borderWidth:0,hoverOffset:6}]},options:dOpts});
  if(CHART_DATA.topRepos.length>0){
    charts.repos=new Chart(document.getElementById("chartRepos"),{type:"bar",
      data:{labels:CHART_DATA.topRepos.map(function(r){return r.name;}),
        datasets:[{label:"Issues",data:CHART_DATA.topRepos.map(function(r){return r.issues;}),xAxisID:"xIssues",_gradBase:cssColors.warn,backgroundColor:cssColors.warn,borderRadius:3},
          {label:"Pull Requests",data:CHART_DATA.topRepos.map(function(r){return r.prs;}),xAxisID:"xPRs",_gradBase:cssColors.accent,backgroundColor:cssColors.accent,borderRadius:3}]},
      options:{indexAxis:"y",responsive:true,
        scales:{xPRs:{position:"bottom",stacked:false,grid:{display:false},beginAtZero:true},xIssues:{position:"top",stacked:false,grid:{display:false},beginAtZero:true},y:{stacked:false,grid:{display:false}}},
        plugins:{legend:{position:"top",align:"end",onClick:function(e,item,legend){
          reposVisibility[item.datasetIndex]=!reposVisibility[item.datasetIndex];
          legend.chart.setDatasetVisibility(item.datasetIndex,reposVisibility[item.datasetIndex]);
          legend.chart.update();
        }}}}});
  }
  if(CHART_DATA.weeklyTrends&&CHART_DATA.weeklyTrends.length>0){
    var tLabels=CHART_DATA.weeklyTrends.map(function(t){return t.week;});
    var lineOpts={responsive:true,maintainAspectRatio:true,
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:cssColors.border}}},
      plugins:{legend:{position:"top",align:"end"}}};
    charts.prTrends=new Chart(document.getElementById("chartPRTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Opened",data:CHART_DATA.weeklyTrends.map(function(t){return t.prsOpened;}),
          borderColor:cssColors.accent,backgroundColor:'transparent',tension:0.3,fill:false,pointRadius:3},
        {label:"Merged",data:CHART_DATA.weeklyTrends.map(function(t){return t.prsMerged;}),
          borderColor:cssColors.ok,backgroundColor:'transparent',tension:0.3,fill:false,pointRadius:3}]},
      options:lineOpts});
    charts.issueTrends=new Chart(document.getElementById("chartIssueTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Opened",data:CHART_DATA.weeklyTrends.map(function(t){return t.issuesOpened;}),
          borderColor:cssColors.warn,backgroundColor:'transparent',tension:0.3,fill:false,pointRadius:3},
        {label:"Closed",data:CHART_DATA.weeklyTrends.map(function(t){return t.issuesClosed;}),
          borderColor:cssColors.ok,backgroundColor:'transparent',tension:0.3,fill:false,pointRadius:3}]},
      options:lineOpts});
    charts.prSizeTrends=new Chart(document.getElementById("chartPRSizeTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Lines Added",data:CHART_DATA.weeklyTrends.map(function(t){return t.linesAdded;}),
          borderColor:cssColors.ok,backgroundColor:'transparent',tension:0.3,fill:false,pointRadius:3},
        {label:"Lines Removed",data:CHART_DATA.weeklyTrends.map(function(t){return t.linesDeleted;}),
          borderColor:cssColors.err,backgroundColor:'transparent',tension:0.3,fill:false,pointRadius:3}]},
      options:lineOpts});
  }
  renderDeliveryCharts();
}
function getISOWeek(d){var date=new Date(d);date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));var y=date.getUTCFullYear();var jan1=new Date(Date.UTC(y,0,1));var wn=Math.ceil(((date.getTime()-jan1.getTime())/86400000+1)/7);return y+"-W"+(wn<10?"0":"")+wn;}
function medianOf(arr){if(!arr.length)return 0;var s=arr.slice().sort(function(a,b){return a-b;});var m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function fmtDur(h){if(h<1)return Math.round(h*60)+"m";if(h<24)return h.toFixed(1)+"h";return(h/24).toFixed(1)+"d";}
/**
 * Build Chart.js annotation plugin config with vertical lines at year
 * boundaries and centered year labels between them.
 * @param labels Array of ISO week labels ("YYYY-Www") currently displayed.
 * @returns annotation plugin options object (empty when <2 years spanned).
 */
function yearBoundaryAnnotations(labels){
  if(!labels||labels.length<2)return {};
  // Determine the set of distinct years present in the labels.
  var years=[];
  labels.forEach(function(lbl){
    var y=parseInt(lbl.slice(0,4),10);
    if(years.indexOf(y)===-1)years.push(y);
  });
  years.sort();
  if(years.length<2)return {};
  // For each year boundary, find the index of the first week of the new year.
  var annotations={};
  for(var i=1;i<years.length;i++){
    var yearStr=String(years[i]);
    var boundaryLabel=yearStr+"-W01";
    var idx=labels.indexOf(boundaryLabel);
    // If W01 is not in the data, find the first label that belongs to this year.
    if(idx===-1){
      for(var j=0;j<labels.length;j++){
        if(labels[j].slice(0,4)===yearStr){idx=j;break;}
      }
    }
    if(idx>0){
      annotations["yearLine"+i]={
        type:"line",
        xMin:idx-0.5,xMax:idx-0.5,
        borderColor:cssColors.muted||"#888",
        borderWidth:1,
        borderDash:[4,4]
      };
    }
  }
  // Add year label in the center of each year's range.
  for(var k=0;k<years.length;k++){
    var yStr=String(years[k]);
    var first=-1,last=-1;
    for(var m=0;m<labels.length;m++){
      if(labels[m].slice(0,4)===yStr){
        if(first===-1)first=m;
        last=m;
      }
    }
    if(first!==-1){
      var center=(first+last)/2;
      annotations["yearLabel"+k]={
        type:"label",
        xValue:center,
        yValue:0,
        yAdjust:-12,
        content:[yStr],
        color:cssColors.muted||"#888",
        font:{size:11,weight:"bold"},
        position:"start"
      };
    }
  }
  return {annotation:{annotations:annotations}};
}
function renderDeliveryCharts(){
  var lineOpts={responsive:true,maintainAspectRatio:true,
    scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:cssColors.border}}},
    plugins:{legend:{position:"top",align:"end"}}};
  // Cycle time chart
  var prs=CHART_DATA.allPRDetails||[];
  if(prs.length>0){
    var weekCycleTimes={};
    prs.forEach(function(p){if(p.timeToMergeHours>0){var w=getISOWeek(p.mergedAt);if(!weekCycleTimes[w])weekCycleTimes[w]=[];weekCycleTimes[w].push(p.timeToMergeHours);}});
    var weeks=Object.keys(weekCycleTimes).sort();
    charts.cycleTime=new Chart(document.getElementById("chartCycleTime"),{type:"line",
      data:{labels:weeks,datasets:[
        {label:"Median cycle time (hours)",data:weeks.map(function(w){return Math.round(medianOf(weekCycleTimes[w])*10)/10;}),
          borderColor:cssColors.accent,backgroundColor:cssColors.accentS,tension:0.3,fill:true,pointRadius:3}]},
      options:lineOpts});
  }
  // Actor breakdown chart
  if(prs.length>0){
    var weekActors={};
    prs.forEach(function(p){
      var w=getISOWeek(p.mergedAt);
      if(!weekActors[w])weekActors[w]={human:0,copilot:0,dependabot:0,otherBot:0};
      if(p.isCopilotAuthored)weekActors[w].copilot++;
      else if(p.isBotAuthor&&p.author&&p.author.toLowerCase().indexOf("dependabot")!==-1)weekActors[w].dependabot++;
      else if(p.isBotAuthor)weekActors[w].otherBot++;
      else weekActors[w].human++;
    });
    var aWeeks=Object.keys(weekActors).sort();
    charts.actorBreakdown=new Chart(document.getElementById("chartActorBreakdown"),{type:"bar",
      data:{labels:aWeeks,datasets:[
        {label:"Human",data:aWeeks.map(function(w){return weekActors[w].human;}),backgroundColor:cssColors.accent,borderRadius:2},
        {label:"Copilot",data:aWeeks.map(function(w){return weekActors[w].copilot;}),backgroundColor:cssColors.purple||"#8250df",borderRadius:2},
        {label:"Dependabot",data:aWeeks.map(function(w){return weekActors[w].dependabot;}),backgroundColor:cssColors.warn,borderRadius:2},
        {label:"Other bots",data:aWeeks.map(function(w){return weekActors[w].otherBot;}),backgroundColor:cssColors.muted,borderRadius:2}]},
      options:{responsive:true,maintainAspectRatio:true,
        scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,beginAtZero:true,grid:{color:cssColors.border}}},
        plugins:{legend:{position:"top",align:"end"}}}});
  }
  // AI adoption doughnut
  var cop=CHART_DATA.copilot||{};
  var copAdoptionHuman=cop.humanMerged!==undefined?cop.humanMerged:(cop.totalMerged-cop.authored);
  if((cop.authored+copAdoptionHuman)>0){
    var dOpts2={cutout:"62%",plugins:{legend:{position:"bottom"}},responsive:true,maintainAspectRatio:true};
    charts.copilotAdoption=new Chart(document.getElementById("chartCopilotAdoption"),{type:"doughnut",
      data:{labels:["AI-authored","Human-authored"],
        datasets:[{data:[cop.authored,copAdoptionHuman],
          backgroundColor:[cssColors.purple||"#8250df",cssColors.accent],borderWidth:0,hoverOffset:6}]},
      options:dOpts2});
  }
  // AI author breakdown doughnut (Copilot vs Claude vs Codex)
  var aiByType=cop.byType||{};
  var aiTotal=(aiByType.copilot||0)+(aiByType.claude||0)+(aiByType.codex||0);
  if(aiTotal>0){
    var dOpts3={cutout:"62%",plugins:{legend:{position:"bottom"}},responsive:true,maintainAspectRatio:true};
    charts.aiAuthorBreakdown=new Chart(document.getElementById("chartAIAuthorBreakdown"),{type:"doughnut",
      data:{labels:["Copilot","Claude","Codex"],
        datasets:[{data:[aiByType.copilot||0,aiByType.claude||0,aiByType.codex||0],
          backgroundColor:[cssColors.purple||"#8250df","#da3f85","#0099e5"],borderWidth:0,hoverOffset:6}]},
      options:dOpts3});
  }
  // Issue lead time scatter
  var lts=CHART_DATA.allIssueLeadTimes||[];
  if(lts.length>0){
    var ltData=lts.map(function(lt){return{x:lt.prMergedAt.slice(0,10),y:Math.round(lt.leadTimeHours/24*10)/10};}).sort(function(a,b){return a.x<b.x?-1:1;});
    charts.leadTime=new Chart(document.getElementById("chartLeadTime"),{type:"bar",
      data:{labels:ltData.map(function(d){return d.x;}),datasets:[
        {label:"Lead time (days)",data:ltData.map(function(d){return d.y;}),
          backgroundColor:cssColors.ok,borderRadius:2}]},
      options:{responsive:true,maintainAspectRatio:true,
        scales:{x:{grid:{display:false}},y:{beginAtZero:true,title:{display:true,text:"Days"},grid:{color:cssColors.border}}},
        plugins:{legend:{display:false}}}});
  }
  // Copilot-authored PRs merged per week (line chart)
  var copPRs=CHART_DATA.allPRDetails||[];
  if(copPRs.length>0){
    var wCopPR={};
    copPRs.forEach(function(p){if(p.isCopilotAuthored){var w=getISOWeek(p.mergedAt);wCopPR[w]=(wCopPR[w]||0)+1;}});
    var copWeeks=Object.keys(wCopPR).sort();
    if(copWeeks.length>0){
      charts.copilotPRTrend=new Chart(document.getElementById("chartCopilotPRTrend"),{type:"line",
        data:{labels:copWeeks,datasets:[
          {label:"Copilot-authored PRs merged",data:copWeeks.map(function(w){return wCopPR[w];}),
            borderColor:cssColors.purple||"#8250df",backgroundColor:"transparent",tension:0.3,fill:false,pointRadius:3}]},
        options:lineOpts});
    }
  }
  // Agent tasks by repo — horizontal stacked bar (30d window, static)
  var agentByRepo=(CHART_DATA.copilotAgent||{}).byRepo||{};
  var agentRepoNames=Object.keys(agentByRepo).filter(function(n){return agentByRepo[n].totalTasks>0;})
    .sort(function(a,b){return agentByRepo[b].totalTasks-agentByRepo[a].totalTasks;}).slice(0,15);
  if(agentRepoNames.length>0){
    charts.agentTasks=new Chart(document.getElementById("chartAgentTasks"),{type:"bar",
      data:{labels:agentRepoNames,datasets:[
        {label:"Completed",data:agentRepoNames.map(function(n){return agentByRepo[n].completed||0;}),backgroundColor:cssColors.ok,borderRadius:2},
        {label:"Failed",data:agentRepoNames.map(function(n){return agentByRepo[n].failed||0;}),backgroundColor:cssColors.err,borderRadius:2},
        {label:"Cancelled",data:agentRepoNames.map(function(n){return agentByRepo[n].cancelled||0;}),backgroundColor:cssColors.warn,borderRadius:2},
        {label:"Timed Out",data:agentRepoNames.map(function(n){return agentByRepo[n].timedOut||0;}),backgroundColor:cssColors.muted,borderRadius:2},
        {label:"Active",data:agentRepoNames.map(function(n){return agentByRepo[n].active||0;}),backgroundColor:cssColors.accent,borderRadius:2}]},
      options:{indexAxis:"y",responsive:true,maintainAspectRatio:true,
        scales:{x:{stacked:true,grid:{display:false},beginAtZero:true},y:{stacked:true,grid:{display:false}}},
        plugins:{legend:{position:"top",align:"end"}},
        onClick:function(e,elements){
          var repoName=null;
          if(elements.length>0){
            repoName=agentRepoNames[elements[0].index];
          } else if(e.native){
            var yAxis=e.chart.scales.y;
            var rect=e.chart.canvas.getBoundingClientRect();
            var cx=e.native.clientX-rect.left;
            var cy=e.native.clientY-rect.top;
            if(cx<yAxis.right){
              for(var i=0;i<agentRepoNames.length;i++){
                if(Math.abs(cy-yAxis.getPixelForTick(i))<15){repoName=agentRepoNames[i];break;}
              }
            }
          }
          if(repoName){window.open("https://github.com/"+(CHART_DATA.owner||"")+"/"+repoName+"/agents","_blank","noopener,noreferrer");}
        },
        onHover:function(e,elements){
          var cursor="default";
          if(elements.length>0){cursor="pointer";}
          else if(e.native){
            var yAxis=e.chart.scales.y;
            var rect=e.chart.canvas.getBoundingClientRect();
            var cx=e.native.clientX-rect.left;
            var cy=e.native.clientY-rect.top;
            if(cx<yAxis.right){
              for(var i=0;i<agentRepoNames.length;i++){
                if(Math.abs(cy-yAxis.getPixelForTick(i))<15){cursor="pointer";break;}
              }
            }
          }
          e.chart.canvas.style.cursor=cursor;}}});
  }
}
function setupFilter(){
  document.querySelectorAll(".filter-btn").forEach(function(btn){
    btn.addEventListener("click",function(){
      document.querySelectorAll(".filter-btn").forEach(function(b){b.classList.remove("active");});
      btn.classList.add("active");
      applyFilter(btn.dataset.period);
    });
  });
  var botCb=document.getElementById("excludeBots");
  if(botCb){botCb.addEventListener("change",function(){
    var activeBtn=document.querySelector(".filter-btn.active");
    applyFilter(activeBtn?activeBtn.dataset.period:"30days");
  });}
}
// ── Repo filter helpers ──
function getRepoFilteredPRDetails(){
  var all=CHART_DATA.allPRDetails||[];
  if(selectedRepos.size===0)return all;
  return all.filter(function(p){return selectedRepos.has(p.repo);});
}
function getRepoFilteredIssueLeadTimes(){
  var all=CHART_DATA.allIssueLeadTimes||[];
  if(selectedRepos.size===0)return all;
  return all.filter(function(p){return selectedRepos.has(p.repo);});
}
function isRepoFilterActive(){
  var total=(CHART_DATA.repoNames||[]).length;
  return selectedRepos.size>0&&selectedRepos.size<total;
}
// Compute weekly PR/size trends from per-PR data (for repo-filtered view).
// Uses org-level week labels as a baseline so charts keep a consistent x-axis.
// prsOpened is NOT computed here (allPRDetails only contains merged PRs).
// Issue counts are always zero — issue trend data is org-wide only.
function computeTrendsFromPRDetails(prs){
  var weekData={};
  (CHART_DATA.weeklyTrends||[]).forEach(function(t){
    weekData[t.week]={week:t.week,prsOpened:0,prsMerged:0,issuesOpened:0,issuesClosed:0,linesAdded:0,linesDeleted:0};
  });
  prs.forEach(function(p){
    var wm=getISOWeek(p.mergedAt);
    if(!weekData[wm])weekData[wm]={week:wm,prsOpened:0,prsMerged:0,issuesOpened:0,issuesClosed:0,linesAdded:0,linesDeleted:0};
    weekData[wm].prsMerged++;
    weekData[wm].linesAdded+=(p.linesAdded||0);
    weekData[wm].linesDeleted+=(p.linesDeleted||0);
  });
  return Object.keys(weekData).map(function(k){return weekData[k];}).sort(function(a,b){return a.week<b.week?-1:1;});
}
// Aggregate PR trends from per-repo data for the selected repos.
// Uses org-level week labels as a baseline for a consistent x-axis.
// prsOpened reflects opened+closed/merged PRs within the window (open-only PRs may be undercounted).
function computePRTrendsForRepos(repoNames){
  var rwt=CHART_DATA.repoWeeklyTrends||{};
  var weekData={};
  (CHART_DATA.weeklyTrends||[]).forEach(function(t){
    weekData[t.week]={week:t.week,prsOpened:0,prsMerged:0,issuesOpened:0,issuesClosed:0,linesAdded:0,linesDeleted:0};
  });
  repoNames.forEach(function(name){
    (rwt[name]||[]).forEach(function(t){
      if(!weekData[t.week])weekData[t.week]={week:t.week,prsOpened:0,prsMerged:0,issuesOpened:0,issuesClosed:0,linesAdded:0,linesDeleted:0};
      weekData[t.week].prsOpened+=(t.prsOpened||0);
      weekData[t.week].prsMerged+=(t.prsMerged||0);
      weekData[t.week].linesAdded+=(t.linesAdded||0);
      weekData[t.week].linesDeleted+=(t.linesDeleted||0);
    });
  });
  return Object.keys(weekData).map(function(k){return weekData[k];}).sort(function(a,b){return a.week<b.week?-1:1;});
}
// Aggregate issue trends from per-repo data for the selected repos.
// Uses org-level week labels as a baseline for a consistent x-axis.
function computeIssueTrendsForRepos(repoNames){
  var rwt=CHART_DATA.repoWeeklyTrends||{};
  var weekData={};
  (CHART_DATA.weeklyTrends||[]).forEach(function(t){
    weekData[t.week]={week:t.week,issuesOpened:0,issuesClosed:0};
  });
  repoNames.forEach(function(name){
    (rwt[name]||[]).forEach(function(t){
      if(!weekData[t.week])weekData[t.week]={week:t.week,issuesOpened:0,issuesClosed:0};
      weekData[t.week].issuesOpened+=(t.issuesOpened||0);
      weekData[t.week].issuesClosed+=(t.issuesClosed||0);
    });
  });
  return Object.keys(weekData).map(function(k){return weekData[k];}).sort(function(a,b){return a.week<b.week?-1:1;});
}
function setupRepoPicker(){
  var names=CHART_DATA.repoNames||[];
  if(names.length===0)return;
  var panel=document.getElementById("repoPickerPanel");
  var list=document.getElementById("repoPickerList");
  var btn=document.getElementById("repoPickerBtn");
  var lbl=document.getElementById("repoPickerLabel");
  var searchInput=document.getElementById("repoPickerSearch");
  if(!panel||!list||!btn)return;
  names.forEach(function(name){
    var item=document.createElement("label");
    item.className="repo-picker-item";
    item.dataset.name=name.toLowerCase();
    var cb=document.createElement("input");
    cb.type="checkbox";
    cb.value=name;
    cb.addEventListener("change",function(){
      if(cb.checked)selectedRepos.add(name);
      else selectedRepos.delete(name);
      updatePickerLabel();
      triggerRepoFilter();
    });
    var txt=document.createTextNode("\u00a0"+name);
    item.appendChild(cb);
    item.appendChild(txt);
    list.appendChild(item);
  });
  btn.addEventListener("click",function(e){
    e.stopPropagation();
    var open=!panel.hidden;
    panel.hidden=open;
    btn.setAttribute("aria-expanded",String(!open));
    if(!open&&searchInput){setTimeout(function(){searchInput.focus();},0);}
  });
  document.addEventListener("click",function(e){
    var picker=document.getElementById("repoPicker");
    if(picker&&!picker.contains(e.target)){panel.hidden=true;btn.setAttribute("aria-expanded","false");}
  });
  var resetBtn=document.getElementById("repoPickerReset");
  var clearBtn=document.getElementById("repoPickerClear");
  if(resetBtn)resetBtn.addEventListener("click",function(){
    selectedRepos=new Set();
    list.querySelectorAll("input[type=checkbox]").forEach(function(cb){cb.checked=false;});
    if(searchInput){searchInput.value="";list.querySelectorAll(".repo-picker-item").forEach(function(it){it.style.display="";});}
    updatePickerLabel();
    triggerRepoFilter();
  });
  if(clearBtn)clearBtn.addEventListener("click",function(){
    list.querySelectorAll("input[type=checkbox]:checked").forEach(function(cb){cb.checked=false;selectedRepos.delete(cb.value);});
    updatePickerLabel();
    triggerRepoFilter();
  });
  if(searchInput)searchInput.addEventListener("input",function(){
    var q=searchInput.value.toLowerCase();
    list.querySelectorAll(".repo-picker-item").forEach(function(item){
      item.style.display=(!q||item.dataset.name.indexOf(q)!==-1)?"":"none";
    });
  });
  function updatePickerLabel(){
    if(!lbl)return;
    var active=isRepoFilterActive();
    if(active){lbl.textContent=selectedRepos.size+" repo"+(selectedRepos.size===1?"":"s");}
    else{lbl.textContent="All repos";}
    btn.classList.toggle("active",active);
  }
  function triggerRepoFilter(){
    var activeBtn=document.querySelector(".filter-btn.active");
    applyFilter(activeBtn?activeBtn.dataset.period:"30days");
  }
}
function getCutoffDate(period){
  var collected=new Date(CHART_DATA.collectedAt);
  var d;
  if(period==="year")return new Date(Date.UTC(collected.getUTCFullYear(),0,1));
  d=new Date(collected);
  if(period==="90days"){d.setUTCDate(d.getUTCDate()-90);return d;}
  if(period==="30days"){d.setUTCDate(d.getUTCDate()-30);return d;}
  return null;
}
function weekToDate(weekStr){
  var parts=weekStr.split("-W");
  var year=parseInt(parts[0],10);var week=parseInt(parts[1],10);
  var jan4=new Date(Date.UTC(year,0,4));
  var dow=jan4.getUTCDay()||7;
  var mon=new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate()-dow+1+(week-1)*7);
  return mon;
}
function applyFilter(period){
  var cutoff=getCutoffDate(period);
  var excludeBots=!!document.getElementById("excludeBots")&&document.getElementById("excludeBots").checked;
  var repoFiltered=isRepoFilterActive();

  // ── Repo-filtered PR base (no period/bot filter yet) ──
  var allPRBase=getRepoFilteredPRDetails();

  // ── Trends ──
  // PR/size trends are recomputed from allPRBase when a repo filter is active.
  // Issue trends use per-repo data when available for ALL selected repos;
  // otherwise fall back to org-wide data.
  var orgTrends=CHART_DATA.weeklyTrends||[];
  var rwt=CHART_DATA.repoWeeklyTrends||{};
  var selRepoArr=repoFiltered?Array.from(selectedRepos):[];
  var allSelectedHaveRepoTrends=repoFiltered&&selRepoArr.length>0&&selRepoArr.every(function(n){return!!rwt[n];});
  var prTrends=allSelectedHaveRepoTrends?computePRTrendsForRepos(selRepoArr):(repoFiltered?computeTrendsFromPRDetails(allPRBase):orgTrends);
  var prTrendsPeriod=cutoff?prTrends.filter(function(t){return weekToDate(t.week)>=cutoff;}):prTrends;
  var issueTrends=allSelectedHaveRepoTrends?computeIssueTrendsForRepos(selRepoArr):orgTrends;
  var issueTrendsPeriod=cutoff?issueTrends.filter(function(t){return weekToDate(t.week)>=cutoff;}):issueTrends;



  // PR trends: hide "Opened" only when repo-filtered without per-repo trend data
  if(charts.prTrends){
    var prTrendLabels=prTrendsPeriod.map(function(t){return t.week;});
    charts.prTrends.data.labels=prTrendLabels;
    charts.prTrends.data.datasets[0].data=prTrendsPeriod.map(function(t){return t.prsOpened;});
    charts.prTrends.data.datasets[1].data=prTrendsPeriod.map(function(t){return t.prsMerged;});
    charts.prTrends.setDatasetVisibility(0,!repoFiltered||allSelectedHaveRepoTrends);
    charts.prTrends.options.plugins.annotation=(yearBoundaryAnnotations(prTrendLabels).annotation||{annotations:{}});
    charts.prTrends.update();
  }
  if(charts.issueTrends){
    var issueTrendLabels=issueTrendsPeriod.map(function(t){return t.week;});
    charts.issueTrends.data.labels=issueTrendLabels;
    charts.issueTrends.data.datasets[0].data=issueTrendsPeriod.map(function(t){return t.issuesOpened;});
    charts.issueTrends.data.datasets[1].data=issueTrendsPeriod.map(function(t){return t.issuesClosed;});
    charts.issueTrends.options.plugins.annotation=(yearBoundaryAnnotations(issueTrendLabels).annotation||{annotations:{}});
    charts.issueTrends.update();
  }
  if(charts.prSizeTrends){
    var prSizeLabels=prTrendsPeriod.map(function(t){return t.week;});
    charts.prSizeTrends.data.labels=prSizeLabels;
    charts.prSizeTrends.data.datasets[0].data=prTrendsPeriod.map(function(t){return t.linesAdded;});
    charts.prSizeTrends.data.datasets[1].data=prTrendsPeriod.map(function(t){return t.linesDeleted;});
    charts.prSizeTrends.options.plugins.annotation=(yearBoundaryAnnotations(prSizeLabels).annotation||{annotations:{}});
    charts.prSizeTrends.update();
  }

  // ── Apply period + bot filter to repo-filtered PR base ──
  var allPR=allPRBase;
  if(excludeBots)allPR=allPR.filter(function(p){return !p.isBotAuthor;});
  var filteredPR=cutoff?allPR.filter(function(p){return new Date(p.mergedAt)>=cutoff;}):allPR;

  // ── Top repos chart ──
  if(charts.repos){
    var titleEl=document.getElementById("chartReposTitle");
    if(repoFiltered){
      // Show only selected repos; all-time issue totals from repoSummaries
      var selArr=Array.from(selectedRepos);
      var selData=selArr.map(function(n){
        var rs=(CHART_DATA.repoSummaries||[]).find(function(r){return r.name===n;})||{issues:0,prs:0};
        var prCnt=0;filteredPR.forEach(function(p){if(p.repo===n)prCnt++;});
        return{name:n,issues:rs.issues,prs:prCnt};
      }).sort(function(a,b){return b.issues+b.prs-(a.issues+a.prs);}).slice(0,15);
      charts.repos.data.labels=selData.map(function(r){return r.name;});
      charts.repos.data.datasets=[
        {label:"Issues",data:selData.map(function(r){return r.issues;}),xAxisID:"xIssues",_gradBase:cssColors.warn,backgroundColor:cssColors.warn,borderRadius:3},
        {label:"Pull Requests",data:selData.map(function(r){return r.prs;}),xAxisID:"xPRs",_gradBase:cssColors.accent,backgroundColor:cssColors.accent,borderRadius:3}];
      var pLabel=period==="all"?"All Time":period==="year"?"This Year":period==="90days"?"Last 90 Days":"Last 30 Days";
      if(titleEl)titleEl.textContent="Selected Repositories \u2014 "+pLabel;
    }else if(period==="all"){
      charts.repos.data.labels=CHART_DATA.topRepos.map(function(r){return r.name;});
      charts.repos.data.datasets=[
        {label:"Issues",data:CHART_DATA.topRepos.map(function(r){return r.issues;}),xAxisID:"xIssues",_gradBase:cssColors.warn,backgroundColor:cssColors.warn,borderRadius:3},
        {label:"Pull Requests",data:CHART_DATA.topRepos.map(function(r){return r.prs;}),xAxisID:"xPRs",_gradBase:cssColors.accent,backgroundColor:cssColors.accent,borderRadius:3}];
      if(titleEl)titleEl.textContent="Top Repositories";
    }else{
      var counts={};
      filteredPR.forEach(function(p){counts[p.repo]=(counts[p.repo]||0)+1;});
      var topFiltered=Object.keys(counts).map(function(n){
        var rd=CHART_DATA.topRepos.find(function(r){return r.name===n;});
        return{name:n,prs:counts[n],issues:rd?rd.issues:0};
      }).sort(function(a,b){return b.prs-a.prs;}).slice(0,15);
      charts.repos.data.labels=topFiltered.map(function(r){return r.name;});
      charts.repos.data.datasets=[
        {label:"Issues",data:topFiltered.map(function(r){return r.issues;}),xAxisID:"xIssues",_gradBase:cssColors.warn,backgroundColor:cssColors.warn,borderRadius:3},
        {label:"Pull Requests",data:topFiltered.map(function(r){return r.prs;}),xAxisID:"xPRs",_gradBase:cssColors.accent,backgroundColor:cssColors.accent,borderRadius:3}];
      var periodLabel=period==="year"?"This Year":period==="90days"?"Last 90 Days":"Last 30 Days";
      if(titleEl)titleEl.textContent="Top Repositories \u2014 "+periodLabel;
    }
    reposVisibility.forEach(function(vis,i){
      if(i<charts.repos.data.datasets.length)charts.repos.setDatasetVisibility(i,vis);
    });
    charts.repos.update();
  }

  // ── Period sums from trends ──
  // Issue counts use per-repo data when available; prsOpened from PR trends (0 when repo-filtered)
  var issuesOpened=0,issuesClosed=0,prsOpened=0;
  issueTrendsPeriod.forEach(function(t){issuesOpened+=(t.issuesOpened||0);issuesClosed+=(t.issuesClosed||0);});
  prTrendsPeriod.forEach(function(t){prsOpened+=(t.prsOpened||0);});
  var prsMerged=filteredPR.length;

  // ── Doughnut charts ──
  if(charts.issues){
    if(period==="all"&&!repoFiltered){
      charts.issues.data.labels=["Open","Closed"];
      charts.issues.data.datasets[0].data=[CHART_DATA.issues.open,CHART_DATA.issues.closed];
    }else{
      charts.issues.data.labels=["Opened","Closed"];
      charts.issues.data.datasets[0].data=[issuesOpened,issuesClosed];
    }
    charts.issues.update();
  }
  if(charts.prs){
    if(period==="all"&&!repoFiltered){
      charts.prs.data.labels=["Open","Merged","Closed"];
      charts.prs.data.datasets[0].data=[CHART_DATA.prs.open,CHART_DATA.prs.merged,CHART_DATA.prs.closed];
      charts.prs.data.datasets[0].backgroundColor=[cssColors.accent,cssColors.ok,cssColors.muted];
    }else if(repoFiltered){
      // Show selected repos' merged PRs as a share of total org merged PRs
      var orgMerged=CHART_DATA.prs.merged;
      charts.prs.data.labels=["Selected repos (merged)","Other repos"];
      charts.prs.data.datasets[0].data=[prsMerged,Math.max(0,orgMerged-prsMerged)];
      charts.prs.data.datasets[0].backgroundColor=[cssColors.ok,cssColors.muted];
    }else{
      charts.prs.data.labels=["Opened","Merged"];
      charts.prs.data.datasets[0].data=[prsOpened,prsMerged];
      charts.prs.data.datasets[0].backgroundColor=[cssColors.accent,cssColors.ok];
    }
    charts.prs.update();
  }

  // ── KPIs ──
  var issueVal=document.getElementById("kpiIssueVal");
  var issueLbl=document.getElementById("kpiIssueLbl");
  var issueSub=document.getElementById("kpiIssueSub");
  var prVal=document.getElementById("kpiPRVal");
  var prLbl=document.getElementById("kpiPRLbl");
  var prSub=document.getElementById("kpiPRSub");
  if(period==="all"&&!repoFiltered){
    if(issueVal)issueVal.textContent=String(CHART_DATA.issues.open);
    if(issueLbl)issueLbl.textContent="Open Issues";
    if(issueSub)issueSub.textContent=CHART_DATA.issues.closed+" closed";
    if(prVal)prVal.textContent=String(CHART_DATA.prs.merged);
    if(prLbl)prLbl.textContent="Merged PRs";
    if(prSub)prSub.textContent=CHART_DATA.prs.open+" open \u00B7 "+CHART_DATA.prs.closed+" closed";
  }else{
    if(issueVal)issueVal.textContent=String(issuesOpened);
    if(issueLbl)issueLbl.textContent="Issues Opened"+(repoFiltered&&!allSelectedHaveRepoTrends?" (org-wide)":"");
    if(issueSub)issueSub.textContent=issuesClosed+" closed";
    if(prVal)prVal.textContent=String(prsMerged);
    if(prLbl)prLbl.textContent="Merged PRs";
    // prsOpened is unavailable per repo only when no per-repo trend data exists
    if(prSub)prSub.textContent=(repoFiltered&&!allSelectedHaveRepoTrends)?"":prsOpened+" opened";
  }

  // ── Copilot adoption ──
  // When repo-filtered: recompute authored % from the repo-filtered all-time PRs.
  // "Reviewed" count is not available per repo; shown only for unfiltered view.
  var cop;
  if(repoFiltered){
    var copAuthored=allPRBase.filter(function(p){return p.isCopilotAuthored;}).length;
    var humanOnly=allPRBase.filter(function(p){return !p.isBotAuthor&&!p.isCopilotAuthored;}).length;
    var btCopilot=allPRBase.filter(function(p){return p.aiAuthorType==='copilot';}).length;
    var btClaude=allPRBase.filter(function(p){return p.aiAuthorType==='claude';}).length;
    var btCodex=allPRBase.filter(function(p){return p.aiAuthorType==='codex';}).length;
    cop={authored:copAuthored,totalMerged:allPRBase.length,humanMerged:humanOnly,reviewed:null,byType:{copilot:btCopilot,claude:btClaude,codex:btCodex}};
  }else{
    cop=CHART_DATA.copilot||{};
  }
  var adoptionHuman=cop.humanMerged!==undefined?cop.humanMerged:(cop.totalMerged-cop.authored);
  var adoptionTotal=cop.authored+adoptionHuman;
  var copilotVal=document.getElementById("kpiCopilotVal");
  var copilotSub=document.getElementById("kpiCopilotSub");
  if(copilotVal){copilotVal.textContent=adoptionTotal>0?(cop.authored/adoptionTotal*100).toFixed(1)+"%":"\u2013";}
  if(copilotSub){
    if(repoFiltered)copilotSub.textContent=(cop.authored||0)+" AI-authored";
    else copilotSub.textContent=(cop.authored||0)+" AI-authored \u00B7 "+(cop.reviewed||0)+" reviewed";
  }
  if(charts.copilotAdoption&&adoptionTotal>0){
    charts.copilotAdoption.data.datasets[0].data=[cop.authored,adoptionHuman];
    charts.copilotAdoption.update();
  }
  if(charts.aiAuthorBreakdown){
    var bt2=cop.byType||{};
    charts.aiAuthorBreakdown.data.datasets[0].data=[bt2.copilot||0,bt2.claude||0,bt2.codex||0];
    charts.aiAuthorBreakdown.update();
  }

  // ── Cycle time KPI ──
  var cycleVals=filteredPR.map(function(p){return p.timeToMergeHours;}).filter(function(h){return h>0;});
  var medCycle=medianOf(cycleVals);
  var cycleVal=document.getElementById("kpiCycleVal");
  if(cycleVal){cycleVal.textContent=medCycle>0?fmtDur(medCycle):"\u2013";}

  // ── Delivery charts ──
  if(charts.cycleTime){
    var weekCT={};
    filteredPR.forEach(function(p){if(p.timeToMergeHours>0){var w=getISOWeek(p.mergedAt);if(!weekCT[w])weekCT[w]=[];weekCT[w].push(p.timeToMergeHours);}});
    var ctWeeks=Object.keys(weekCT).sort();
    charts.cycleTime.data.labels=ctWeeks;
    charts.cycleTime.data.datasets[0].data=ctWeeks.map(function(w){return Math.round(medianOf(weekCT[w])*10)/10;});
    charts.cycleTime.options.plugins.annotation=(yearBoundaryAnnotations(ctWeeks).annotation||{annotations:{}});
    charts.cycleTime.update();
  }
  if(charts.actorBreakdown){
    var wA={};
    filteredPR.forEach(function(p){
      var w=getISOWeek(p.mergedAt);
      if(!wA[w])wA[w]={human:0,copilot:0,dependabot:0,otherBot:0};
      if(p.isCopilotAuthored)wA[w].copilot++;
      else if(p.isBotAuthor&&p.author&&p.author.toLowerCase().indexOf("dependabot")!==-1)wA[w].dependabot++;
      else if(p.isBotAuthor)wA[w].otherBot++;
      else wA[w].human++;
    });
    var aW=Object.keys(wA).sort();
    charts.actorBreakdown.data.labels=aW;
    charts.actorBreakdown.data.datasets[0].data=aW.map(function(w){return wA[w].human;});
    charts.actorBreakdown.data.datasets[1].data=aW.map(function(w){return wA[w].copilot;});
    charts.actorBreakdown.data.datasets[2].data=aW.map(function(w){return wA[w].dependabot;});
    charts.actorBreakdown.data.datasets[3].data=aW.map(function(w){return wA[w].otherBot;});
    charts.actorBreakdown.options.plugins.annotation=(yearBoundaryAnnotations(aW).annotation||{annotations:{}});
    charts.actorBreakdown.update();
  }

  // ── Copilot PR trend chart ──
  if(charts.copilotPRTrend){
    var wCopPR2={};
    filteredPR.forEach(function(p){if(p.isCopilotAuthored){var w=getISOWeek(p.mergedAt);wCopPR2[w]=(wCopPR2[w]||0)+1;}});
    var copWeeks2=Object.keys(wCopPR2).sort();
    charts.copilotPRTrend.data.labels=copWeeks2;
    charts.copilotPRTrend.data.datasets[0].data=copWeeks2.map(function(w){return wCopPR2[w];});
    charts.copilotPRTrend.options.plugins.annotation=(yearBoundaryAnnotations(copWeeks2).annotation||{annotations:{}});
    charts.copilotPRTrend.update();
  }

  // ── Agent tasks KPI (responds to repo filter; not period-filtered) ──
  var agentVal=document.getElementById("kpiAgentVal");
  var agentSub=document.getElementById("kpiAgentSub");
  var agentCopilotData=CHART_DATA.copilotAgent||{};
  if(repoFiltered){
    var selAgentTasks=0,selAgentCompleted=0,selAgentPRs=0;
    var aByRepo=agentCopilotData.byRepo||{};
    Array.from(selectedRepos).forEach(function(name){
      var rd=aByRepo[name];
      if(rd){selAgentTasks+=rd.totalTasks;selAgentCompleted+=rd.completed;selAgentPRs+=rd.agentPRs;}
    });
    if(agentVal)agentVal.textContent=selAgentTasks>0?String(selAgentTasks):"\u2013";
    if(agentSub)agentSub.textContent=selAgentTasks>0?selAgentCompleted+" completed \u00B7 "+selAgentPRs+" PRs":"no agent data";
  }else{
    if(agentVal)agentVal.textContent=agentCopilotData.totalTasks>0?String(agentCopilotData.totalTasks):"\u2013";
    if(agentSub)agentSub.textContent=agentCopilotData.totalTasks>0?agentCopilotData.completed+" completed \u00B7 "+agentCopilotData.agentPRs+" PRs":"no agent data";
  }

  // ── Issue lead times chart ──
  var filteredLT=getRepoFilteredIssueLeadTimes();
  if(cutoff)filteredLT=filteredLT.filter(function(lt){return new Date(lt.prMergedAt)>=cutoff;});
  if(charts.leadTime){
    var ltData=filteredLT.map(function(lt){return{x:lt.prMergedAt.slice(0,10),y:Math.round(lt.leadTimeHours/24*10)/10};}).sort(function(a,b){return a.x<b.x?-1:1;});
    charts.leadTime.data.labels=ltData.map(function(d){return d.x;});
    charts.leadTime.data.datasets[0].data=ltData.map(function(d){return d.y;});
    charts.leadTime.update();
  }

  // ── Repo table merged-PR cells ──
  if(period==="all"&&!repoFiltered){
    document.querySelectorAll(".repo-row[data-repo-name]").forEach(function(row){
      var cell=row.querySelector(".td-merged-prs");
      var v=String(row.dataset.mergedPrsAll||0);
      if(cell)cell.textContent=v;
      row.dataset.mergedPrs=v;
    });
  }else{
    var repoCounts={};
    filteredPR.forEach(function(p){var key=p.repo.toLowerCase();repoCounts[key]=(repoCounts[key]||0)+1;});
    document.querySelectorAll(".repo-row[data-repo-name]").forEach(function(row){
      var cell=row.querySelector(".td-merged-prs");
      var v=String(repoCounts[row.dataset.repoName]||0);
      if(cell)cell.textContent=v;
      row.dataset.mergedPrs=v;
    });
  }
  var note=document.getElementById("reposPeriodNote");
  if(note)note.style.display=(period==="all"&&!repoFiltered)?"none":"";
}
function compareRows(a,b,by){
  if(by==="name")return a.dataset.name.localeCompare(b.dataset.name,undefined,{sensitivity:"base"});
  if(by==="pushed"){var pa=a.dataset.pushed||"";var pb=b.dataset.pushed||"";return pb.localeCompare(pa);}
  return Number(b.dataset[by]||0)-Number(a.dataset[by]||0);
}
function setupControls(){
  var f=document.getElementById("repoFilter");
  var st=document.getElementById("repoSort");
  var list=document.getElementById("repoList");
  var sh=document.getElementById("shown");
  if(!f||!list)return;
  function filterAndSort(){
    var q=f.value.toLowerCase();var by=st?st.value:"name";
    var n=0;
    var tbody=list;
    var grpHdrRows=Array.from(tbody.querySelectorAll("tr.grp-hdr-row"));
    if(grpHdrRows.length>0){
      grpHdrRows.forEach(function(hdrRow){
        var grpId=hdrRow.dataset.grpId;
        var dataRows=Array.from(tbody.querySelectorAll("tr.repo-row[data-grp-id='"+grpId+"']"));
        dataRows.sort(function(a,b){return compareRows(a,b,by);});
        // Find next group header to use as insertion point
        var nextHdr=hdrRow.nextElementSibling;
        while(nextHdr&&!nextHdr.classList.contains("grp-hdr-row")){nextHdr=nextHdr.nextElementSibling;}
        // Save detail-row refs before removal — getElementById won't find detached nodes
        var drMap=new Map();
        dataRows.forEach(function(row){
          var dr=document.getElementById("detail-"+row.dataset.repoId);
          drMap.set(row,dr);
          if(row.parentNode)row.parentNode.removeChild(row);
          if(dr&&dr.parentNode)dr.parentNode.removeChild(dr);
        });
        dataRows.forEach(function(row){
          var match=row.dataset.name.indexOf(q)!==-1;
          var grpHidden=!!row.dataset.grpHidden;
          row.style.display=(!match||grpHidden)?"none":"";
          if(match&&!grpHidden)n++;
          tbody.insertBefore(row,nextHdr||null);
          var dr=drMap.get(row);
          if(dr){
            if(!match||grpHidden)dr.style.display="none";
            else dr.style.display=dr.hidden?"none":"";
            tbody.insertBefore(dr,nextHdr||null);
          }
        });
      });
      // Hide group headers whose rows are all filtered out
      grpHdrRows.forEach(function(hdrRow){
        var grpId=hdrRow.dataset.grpId;
        var visible=Array.from(tbody.querySelectorAll("tr.repo-row[data-grp-id='"+grpId+"']"))
          .filter(function(r){return r.style.display!=="none";}).length;
        hdrRow.style.display=visible>0?"":"none";
      });
    }else{
      var allDataRows=Array.from(tbody.querySelectorAll("tr.repo-row"));
      allDataRows.sort(function(a,b){return compareRows(a,b,by);});
      allDataRows.forEach(function(row){
        var match=row.dataset.name.indexOf(q)!==-1;
        row.style.display=match?"":"none";
        if(match)n++;
        tbody.appendChild(row);
        var dr=document.getElementById("detail-"+row.dataset.repoId);
        if(dr){
          if(!match)dr.style.display="none";
          else dr.style.display=dr.hidden?"none":"";
          tbody.appendChild(dr);
        }
      });
    }
    if(sh)sh.textContent=String(n);
  }
  f.addEventListener("input",filterAndSort);
  if(st)st.addEventListener("change",filterAndSort);
}
function setupSortHeaders(){
  var st=document.getElementById("repoSort");
  document.querySelectorAll(".th-sortable").forEach(function(th){
    th.addEventListener("click",function(){
      var sortKey=th.dataset.sort;
      document.querySelectorAll(".th-sortable").forEach(function(h){
        h.classList.remove("sort-active");
        var ind=h.querySelector(".sort-ind");if(ind)ind.textContent="";
      });
      th.classList.add("sort-active");
      var ind=th.querySelector(".sort-ind");
      if(ind)ind.textContent=(sortKey==="name"||sortKey==="pushed")?"↑":"↓";
      if(st){st.value=sortKey;st.dispatchEvent(new Event("change"));}
    });
  });
}
function setupGroups(){
  var now=Date.now();
  var groupDefs=[
    {id:"grp-month",label:"Last Month",maxDays:30},
    {id:"grp-quarter",label:"Last Quarter",maxDays:90},
    {id:"grp-halfyear",label:"Last Half Year",maxDays:180},
    {id:"grp-older",label:"Older",maxDays:Infinity}
  ];
  var tbody=document.getElementById("repoList");
  if(!tbody)return;
  var dataRows=Array.from(tbody.querySelectorAll("tr.repo-row"));
  // Build detail-row map before removing from DOM (getElementById won't find detached nodes)
  var drMap=new Map();
  dataRows.forEach(function(row){
    drMap.set(row,document.getElementById("detail-"+row.dataset.repoId));
  });
  var allRows=Array.from(tbody.querySelectorAll("tr"));
  allRows.forEach(function(r){if(r.parentNode)r.parentNode.removeChild(r);});
  var groups={};
  groupDefs.forEach(function(g){groups[g.id]=[];});
  dataRows.forEach(function(row){
    var pushed=row.dataset.pushed;
    var days=pushed&&pushed.length>0?utcDaysSince(pushed,now):Infinity;
    var targetId=groupDefs[groupDefs.length-1].id;
    for(var i=0;i<groupDefs.length;i++){if(days<=groupDefs[i].maxDays){targetId=groupDefs[i].id;break;}}
    var ageBadge=row.querySelector(".bdg-age");
    if(ageBadge){var ageStr=computeAge(days);ageBadge.textContent=ageStr;ageBadge.style.display=ageStr?"":"none";}
    row.dataset.grpId=targetId;
    var dr=drMap.get(row);
    if(dr)dr.dataset.grpId=targetId;
    groups[targetId].push(row);
  });
  var firstOpened=false;
  groupDefs.forEach(function(g){
    var grpRows=groups[g.id];
    if(grpRows.length===0)return;
    var hdrTr=document.createElement("tr");
    hdrTr.className="grp-hdr-row";
    hdrTr.dataset.grpId=g.id;
    hdrTr.innerHTML='<td colspan="9" class="grp-hdr-cell"><span class="grp-chevron">&#9654;</span><span class="grp-label">'+g.label+'</span><span class="grp-count"> ('+grpRows.length+')</span></td>';
    hdrTr.addEventListener("click",function(){toggleGroup(g.id);});
    tbody.appendChild(hdrTr);
    grpRows.forEach(function(row){
      tbody.appendChild(row);
      var dr=drMap.get(row);
      if(dr)tbody.appendChild(dr);
    });
    if(!firstOpened){
      firstOpened=true;
      hdrTr.classList.add("expanded");
    }else{
      grpRows.forEach(function(row){
        row.style.display="none";row.dataset.grpHidden="1";
        var dr=drMap.get(row);
        if(dr){dr.style.display="none";dr.dataset.grpHidden="1";}
      });
    }
  });
}
function toggleGroup(grpId){
  var hdrRow=document.querySelector(".grp-hdr-row[data-grp-id='"+grpId+"']");
  if(!hdrRow)return;
  var expanded=hdrRow.classList.toggle("expanded");
  var tbody=document.getElementById("repoList");
  var dataRows=Array.from(tbody.querySelectorAll("tr.repo-row[data-grp-id='"+grpId+"']"));
  dataRows.forEach(function(row){
    if(expanded){
      delete row.dataset.grpHidden;
      row.style.display="";
    }else{
      row.dataset.grpHidden="1";
      row.style.display="none";
      var dr=document.getElementById("detail-"+row.dataset.repoId);
      if(dr){dr.style.display="none";dr.dataset.grpHidden="1";}
    }
  });
}
function utcDaysSince(isoDate,nowMs){
  var d=new Date(isoDate);
  var pushedMs=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  var nowDate=new Date(nowMs);
  var todayMs=Date.UTC(nowDate.getUTCFullYear(),nowDate.getUTCMonth(),nowDate.getUTCDate());
  return Math.max(0,(todayMs-pushedMs)/86400000);
}
function computeAge(days){
  if(!isFinite(days))return "";
  if(days<1)return "today";
  days=Math.floor(days);
  if(days<7)return days+"d";
  var w=Math.floor(days/7);
  if(w<5)return w+"w";
  var m=Math.floor(days/30);
  if(m<12)return m+"mo";
  return Math.floor(days/365)+"y";
}
function toggleRepo(btn){
  var row=btn.closest("tr.repo-row");
  if(!row)return;
  var repoId=row.dataset.repoId;
  var dr=document.getElementById("detail-"+repoId);
  var exp=btn.getAttribute("aria-expanded")==="true";
  btn.setAttribute("aria-expanded",String(!exp));
  if(dr){dr.hidden=exp;dr.style.display=exp?"none":"";}
  row.classList.toggle("expanded");
}`;
}