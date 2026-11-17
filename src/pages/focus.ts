import type { FocusConfig } from "../config.js";
import { escapeHtml } from "./utils.js";

/** Classify PR ownership without retaining the configured roster in the page. */
export function classifyFocusAuthor(author: string, users: ReadonlySet<string>): "focus" | "rest" | "unknown" {
  const login = author.trim().toLowerCase();
  if (!login || ["unknown", "ghost", "[deleted]"].includes(login)) return "unknown";
  return users.has(login) ? "focus" : "rest";
}

/** The author-cohort comparison, revealed by the filter bar's comparison control. */
export function buildFocusSection(focus: FocusConfig): string {
  return `<section id="focusComparison" class="focus-comparison" aria-label="Focus versus rest comparison" hidden>
  <div class="card metric-card">
    <h2>${escapeHtml(focus.name)} vs rest</h2>
    <p class="metric-lede">PRs authored by the configured group versus other known PR authors in the same selected repositories.
    This is PR ownership, not commit effort: co-authored or mixed commits do not change a PR's cohort.
    Bot-authored PRs stay with their actual author; no human sponsor is inferred.
    Review metrics describe reviews received, not reviews performed by group members.</p>
    <p id="focusCoverage" class="trial-note" role="status"></p>
    <div class="trial-table-wrap"><table class="trial-table">
      <thead><tr><th scope="col">Metric</th><th scope="col">${escapeHtml(focus.name)}</th><th scope="col">Rest</th><th scope="col">Focus minus rest</th></tr></thead>
      <tbody id="focusMetricRows"></tbody>
    </table></div>
    <p class="trial-note">Each median and rate is computed separately, not subtracted from an all-author aggregate.
    Unknown authors are excluded from both cohorts and shown separately in counts. Missing measurements are unavailable, not zero.
    Small cohorts are descriptive, not evidence of a productivity difference.</p>
  </div>
  <div class="charts">
    <div class="card card-chart"><h2>Merged PRs by author group</h2><canvas id="focusPRShare"></canvas></div>
    <div class="card card-chart"><h2>AI adoption by PR author group</h2><canvas id="focusAI"></canvas></div>
    <div class="card card-chart card-wide"><h2>Repositories: merged PRs by author group</h2><canvas id="focusRepos"></canvas></div>
    <div class="card card-chart card-wide"><h2>Merged PRs per week</h2><canvas id="focusWeekly"></canvas></div>
    <div class="card card-chart card-wide"><h2>Known lines added / deleted per merge week</h2><canvas id="focusLines"></canvas></div>
    <div class="card card-chart card-wide"><h2>PR cycle time: weekly median hours</h2><canvas id="focusCycle"></canvas></div>
    <div class="card card-chart card-wide"><h2>Wait for first review: weekly median hours</h2><canvas id="focusReview"></canvas></div>
  </div>
</section>`;
}

/** Client-side cohort rendering, sharing the dashboard's period and repository filters. */
export function getFocusJS(): string {
  return `
var focusCharts={};
function setupFocusComparison(){
  document.querySelectorAll(".focus-mode-btn").forEach(function(button){
    button.addEventListener("click",function(){
      focusCompare=button.dataset.comparison==="focus"&&!!CHART_DATA.focus;
      var active=document.querySelector(".filter-btn.active");
      applyFilter(active?active.dataset.period:"30days");
    });
  });
}
function destroyFocusCharts(){
  Object.keys(focusCharts).forEach(function(key){focusCharts[key].destroy();});
  focusCharts={};
}
function focusCohort(pr){
  return pr.cohort==="focus"?"focus":pr.cohort==="rest"?"rest":"unknown";
}
function focusSummary(prs,closed){
  var cycles=[],reviews=[],approvals=[],mergeWaits=[],sizes=[],rounds=[],comments=[],threads=[],postReview=[];
  var added=0,deleted=0,addedN=0,deletedN=0,sized=0,ai=0;
  prs.forEach(function(pr){
    if(pr.cycleTimeKnown!==false&&Number.isFinite(pr.timeToMergeHours)&&pr.timeToMergeHours>=0)cycles.push(pr.timeToMergeHours);
    var wait=hoursBetweenISO(pr.createdAt,pr.firstReviewAt);
    if(wait!==null)reviews.push(wait);
    var approval=hoursBetweenISO(pr.createdAt,pr.firstApprovalAt);
    if(approval!==null)approvals.push(approval);
    var mergeWait=hoursBetweenISO(pr.firstApprovalAt,pr.mergedAt);
    if(mergeWait!==null)mergeWaits.push(mergeWait);
    if(Number.isFinite(pr.linesAdded)&&Number.isFinite(pr.linesDeleted)){
      sized++;
      sizes.push(pr.linesAdded+pr.linesDeleted);
    }
    if(Number.isFinite(pr.linesAdded)){added+=pr.linesAdded;addedN++;}
    if(Number.isFinite(pr.linesDeleted)){deleted+=pr.linesDeleted;deletedN++;}
    if(pr.reviewCount>0)rounds.push(pr.reviewCount);
    if(Number.isFinite(pr.conversationCommentCount))comments.push(pr.conversationCommentCount);
    if(Number.isFinite(pr.reviewThreadCount))threads.push(pr.reviewThreadCount);
    if(pr.postReviewCommits&&!pr.postReviewCommits.partial)postReview.push(pr.postReviewCommits.count);
    if(pr.isCopilotAuthored)ai++;
  });
  return {merged:prs.length,cycle:pctl(cycles,50),review:pctl(reviews,50),
    approval:pctl(approvals,50),mergeWait:pctl(mergeWaits,50),
    size:pctl(sizes,50),rounds:pctl(rounds,50),comments:pctl(comments,50),threads:pctl(threads,50),
    postReview:pctl(postReview,50),postReviewN:postReview.length,
    added:addedN?added:null,deleted:deletedN?deleted:null,sized:sized,reviewed:reviews.length,
    ai:prs.length?ai/prs.length*100:null,
    abandonment:closed===null?null:prs.length+closed?closed/(prs.length+closed)*100:null,
    samples:{cycle:cycles.length,review:reviews.length,approval:approvals.length,mergeWait:mergeWaits.length,
      size:sizes.length,added:addedN,deleted:deletedN,rounds:rounds.length,comments:comments.length,threads:threads.length,
      postReview:postReview.length,ai:prs.length,abandonment:closed===null?0:prs.length+closed}};
}
function focusCell(row,text,tag){
  var cell=document.createElement(tag||"td");
  if(tag==="th")cell.scope="row";
  cell.textContent=text;row.appendChild(cell);return cell;
}
function updateFocusComparison(prs,closed,period,excludeBots,repoFiltered){
  var enabled=focusCompare&&!!CHART_DATA.focus;
  document.querySelectorAll(".focus-mode-btn").forEach(function(button){
    var active=(button.dataset.comparison==="focus")===enabled;
    button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));
  });
  var section=document.getElementById("focusComparison");
  if(!section)return;
  section.hidden=!enabled;
  document.querySelectorAll(".kpis,.trial,[aria-label='Review flow'],[aria-label='Reviews and rework by repository'],[aria-label='AI versus human pull requests']").forEach(function(el){
    el.classList.toggle("focus-all-hidden",enabled);
  });
  ["chartPRs","chartRepos","chartPRTrends","chartPRSizeTrends","chartCycleTime","chartActorBreakdown",
    "chartCopilotAdoption","chartAIAuthorBreakdown","chartLeadTime","chartReviewWait","chartCopilotPRTrend"].forEach(function(id){
    var canvas=document.getElementById(id);
    if(canvas)canvas.closest(".card").classList.toggle("focus-all-hidden",enabled);
  });
  document.querySelectorAll("main > .charts").forEach(function(container){
    container.classList.toggle("focus-all-hidden",enabled&&Array.from(container.children).every(function(card){
      return card.classList.contains("focus-all-hidden");
    }));
  });
  ["chartIssues","chartIssueTrends","chartReviewerLoad","chartAgentTasks"].forEach(function(id){
    var canvas=document.getElementById(id);
    if(!canvas)return;
    var card=canvas.closest(".card"),note=card.querySelector(".focus-context");
    if(!note){note=document.createElement("p");note.className="focus-context metric-lede";
      note.textContent="Repository-wide context; not split by PR author.";card.querySelector("h2").after(note);}
    note.hidden=!enabled;
  });
  var ci=document.querySelector("[aria-label='CI health']");
  if(ci){
    var ciNote=ci.querySelector(".focus-context");
    if(!ciNote){ciNote=document.createElement("p");ciNote.className="focus-context metric-lede";
      ciNote.textContent="Repository-wide CI health, not attributable to a PR-author group.";ci.querySelector("h2").after(ciNote);}
    ciNote.hidden=!enabled;
  }
  document.querySelectorAll(".focus-repo-cell").forEach(function(cell){cell.hidden=!enabled;});
  var existingRepoNote=document.getElementById("focusRepoNote");
  if(existingRepoNote)existingRepoNote.hidden=!enabled;
  document.querySelectorAll(".repo-detail-cell,.grp-hdr-cell").forEach(function(cell){cell.colSpan=enabled?10:9;});
  if(!enabled){
    Object.keys(charts).forEach(function(key){if(charts[key].resize)charts[key].resize();});
    return;
  }
  if(excludeBots)prs=prs.filter(function(pr){return pr.botAuthorKnown!==false;});
  var groups=["focus","rest","unknown"];
  var names=[CHART_DATA.focus.name,"Rest","Unknown author"];
  var colors=[cssColors.accent,cssColors.ok,cssColors.muted];
  var selected=(CHART_DATA.repoSummaries||[]).filter(function(repo){return !repoFiltered||selectedRepos.has(repo.name);});
  var closedKnown=selected.every(function(repo){return repo.hasClosedTimeline;});
  var cohorts=groups.map(function(group){return prs.filter(function(pr){return focusCohort(pr)===group;});});
  var summaries=groups.map(function(group,i){
    return focusSummary(cohorts[i],closedKnown?closed.filter(function(pr){return focusCohort(pr)===group;}).length:null);
  });
  var body=document.getElementById("focusMetricRows");body.replaceChildren();
  [
    ["merged","Merged PRs",fmtCount,false],
    ["cycle","Median cycle time",fmtHours,false],
    ["review","Median first-review wait",fmtHours,false],
    ["approval","Median first-approval wait",fmtHours,false],
    ["mergeWait","Median approval-to-merge wait",fmtHours,false],
    ["size","Median PR size (known lines)",fmtLines,false],
    ["added","Known lines added",fmtCount,false],
    ["deleted","Known lines deleted",fmtCount,false],
    ["rounds","Median reviews per reviewed PR",fmtRounds,false],
    ["comments","Median conversation comments",fmtRounds,false],
    ["threads","Median review threads",fmtRounds,false],
    ["postReview","Median post-review commits (complete evidence)",fmtRounds,false],
    ["ai","AI-attributed share of merged PRs",fmtPct,true],
    ["abandonment","Abandoned share of concluded PRs",fmtPct,true]
  ].forEach(function(metric){
    var row=document.createElement("tr");row.dataset.metric=metric[0];
    focusCell(row,metric[1],"th");
    var a=summaries[0][metric[0]],b=summaries[1][metric[0]];
    [a,b].forEach(function(value,i){
      var cell=focusCell(row,value===null?"Unavailable":metric[2](value));
      var n=summaries[i].samples[metric[0]];
      if(value!==null&&n!==undefined){
        var sample=document.createElement("small");sample.className="focus-sample";
        sample.textContent=" (n="+n+")";cell.appendChild(sample);
      }
    });
    var delta=a===null||b===null?"Unavailable":
      (a-b>0?"+":a-b<0?"-":"")+ (metric[3]?Math.abs(a-b).toFixed(1)+" pp":metric[2](Math.abs(a-b)));
    focusCell(row,delta);body.appendChild(row);
  });
  var notes=[getPeriodLabel(period)+": "+prs.length+" collected merged PRs; "+
    names[0]+" "+cohorts[0].length+", rest "+cohorts[1].length+", unknown author "+cohorts[2].length+"."];
  notes.push("First-review samples: "+summaries[0].reviewed+" vs "+summaries[1].reviewed+
    "; complete line samples: "+summaries[0].sized+" vs "+summaries[1].sized+
    "; complete post-review samples: "+summaries[0].postReviewN+" vs "+summaries[1].postReviewN+".");
  if(cohorts[0].length<20||cohorts[1].length<20)notes.push("Small sample: interpret differences cautiously.");
  if(!closedKnown)notes.push("Abandonment unavailable: some selected repositories have no closed-PR timeline.");
  if(selected.some(function(repo){return !repo.hasMergedTimeline;}))notes.push("Some repositories provide only a small detailed PR sample.");
  if(excludeBots)notes.push("Bot-authored PRs excluded from both cohorts; detailed-only PRs without bot identity evidence are omitted.");
  notes.push("Capped or missing history can undercount both groups; see collection warnings. All Time means all collected PRs, not lifetime totals. Merged metrics use merge date; abandonment also uses unmerged close date. Open PRs, issues, people, dependents, issue lead time, agent tasks and CI are not split by PR author.");
  document.getElementById("focusCoverage").textContent=notes.join(" ");
  document.querySelectorAll(".repo-row").forEach(function(row){
    var repoPRs=prs.filter(function(pr){return pr.repo.toLowerCase()===row.dataset.repoName;});
    var counts=groups.map(function(group){return repoPRs.filter(function(pr){return focusCohort(pr)===group;}).length;});
    var cell=row.querySelector(".focus-repo-cell");
    if(!cell)return;
    cell.replaceChildren();
    var countText=document.createElement("span");
    countText.textContent=counts.join(" / ");cell.appendChild(countText);
    var share=document.createElement("small");
    share.textContent=repoPRs.length?(counts[0]/repoPRs.length*100).toFixed(1)+"% focus":"No collected merged PRs";
    cell.appendChild(share);
    cell.title=names[0]+" / Rest / Unknown author; collected merged PRs in "+getPeriodLabel(period,true);
  });
  var repoNote=document.getElementById("focusRepoNote");
  if(!repoNote){repoNote=document.createElement("p");repoNote.id="focusRepoNote";repoNote.className="repos-period-note";
    document.getElementById("reposPeriodNote").after(repoNote);}
  repoNote.textContent="Focus / Rest / Unknown are disjoint PR-author counts, not commit effort. The focus share uses all collected merged PRs, including unknown authors. Merged totals and lines use the same collected period sample; other repository columns remain repository-wide.";
  if(typeof Chart==="undefined")return;
  var weeks=Array.from(new Set(prs.map(function(pr){return getISOWeek(pr.mergedAt);}))).sort();
  var lineOptions={responsive:true,maintainAspectRatio:true,
    scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:cssColors.border}}},
    plugins:{legend:{position:"top"},annotation:trendAnnotations(weeks)}};
  function draw(id,type,labels,datasets,options){
    var canvas=document.getElementById(id);
    var measured=prs.length>0&&datasets.some(function(dataset){return dataset.data.some(function(value){
      return value!==null&&Number.isFinite(value);
    });});
    var empty=document.getElementById(id+"Empty");
    if(!empty){empty=document.createElement("p");empty.id=id+"Empty";empty.className="metric-lede focus-context";
      empty.textContent="No measured PRs in this selection.";canvas.before(empty);}
    empty.hidden=measured;canvas.classList.toggle("focus-chart-empty",!measured);
    var chart=focusCharts[id];
    if(!measured&&!chart)return;
    if(!chart){focusCharts[id]=new Chart(canvas,{type:type,data:{labels:labels,datasets:datasets},options:options});}
    else{chart.data.labels=labels;chart.data.datasets=datasets;
      if(chart.options.plugins)chart.options.plugins.annotation=trendAnnotations(labels);
      chart.update();}
  }
  function series(values,label,index){
    return {label:label,data:values,borderColor:colors[index],backgroundColor:colors[index],
      borderDash:index===1?[6,3]:index===2?[2,3]:[],fill:false,tension:0.2,pointRadius:3};
  }
  draw("focusPRShare","doughnut",names,[{data:cohorts.map(function(group){return group.length;}),
    backgroundColor:colors,borderWidth:0}],{responsive:true,plugins:{legend:{position:"bottom"}}});
  draw("focusAI","bar",names.slice(0,2),[{label:"AI-attributed PRs (%)",data:summaries.slice(0,2).map(function(s){return s.ai;}),
    backgroundColor:colors.slice(0,2)}],{responsive:true,scales:{y:{beginAtZero:true,max:100}},plugins:{legend:{display:false}}});
  var repoNames=Array.from(new Set(prs.map(function(pr){return pr.repo;}))).sort(function(a,b){
    return prs.filter(function(pr){return pr.repo===b;}).length-prs.filter(function(pr){return pr.repo===a;}).length;
  }).slice(0,15);
  draw("focusRepos","bar",repoNames,groups.map(function(group,i){
    return {label:names[i],data:repoNames.map(function(repo){return cohorts[i].filter(function(pr){return pr.repo===repo;}).length;}),
      backgroundColor:colors[i]};
  }),{responsive:true,indexAxis:"y",scales:{x:{stacked:true,beginAtZero:true},y:{stacked:true}},plugins:{legend:{position:"top"}}});
  draw("focusWeekly","bar",weeks,groups.map(function(group,i){
    return {label:names[i],data:weeks.map(function(week){return cohorts[i].filter(function(pr){return getISOWeek(pr.mergedAt)===week;}).length;}),
      backgroundColor:colors[i]};
  }),{responsive:true,scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}},plugins:{legend:{position:"top"},annotation:trendAnnotations(weeks)}});
  ["focusCycle","focusReview"].forEach(function(id){
    draw(id,"line",weeks,groups.slice(0,2).map(function(group,i){
      return series(weeks.map(function(week){
        var values=cohorts[i].filter(function(pr){return getISOWeek(pr.mergedAt)===week;}).map(function(pr){
          return id==="focusCycle"?(pr.cycleTimeKnown===false?null:pr.timeToMergeHours):hoursBetweenISO(pr.createdAt,pr.firstReviewAt);
        }).filter(function(value){return value!==null&&Number.isFinite(value)&&value>=0;});
        return pctl(values,50);
      }),names[i],i);
    }),lineOptions);
  });
  var lineSeries=[];
  groups.slice(0,2).forEach(function(group,i){
    ["linesAdded","linesDeleted"].forEach(function(field){
      var dataset=series(weeks.map(function(week){
        var values=cohorts[i].filter(function(pr){return getISOWeek(pr.mergedAt)===week&&Number.isFinite(pr[field]);});
        return values.length?values.reduce(function(sum,pr){return sum+pr[field];},0):null;
      }),names[i]+(field==="linesAdded"?" added":" deleted"),i);
      if(field==="linesDeleted")dataset.borderDash=[2,3];
      lineSeries.push(dataset);
    });
  });
  draw("focusLines","line",weeks,lineSeries,lineOptions);
}
`;
}
