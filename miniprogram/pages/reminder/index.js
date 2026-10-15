const ui=require('../../services/ui');
const {features}=require('../../services/features-client');
const work=require('../../services/feature-page');
const { supervision }=require('../../services/supervision-client');
const LABELS={pending:'已申请，等待发送',claimed:'正在处理，不能撤回在途消息',sent:'平台已接受发送请求',cancelled:'已取消／不再需要发送',failed:'未发送',unknown:'发送未确认，不会自动重发'};
Page(ui.withLifecycle({
  data:{enabled:false,loading:true,dataReady:false,dataUnavailable:false,error:'',busy:false,slots:['08:00','12:30','20:30'],slotIndex:2,preview:null,items:[],retrySchedule:false,
    modern:false,type:'self',businessDate:'',minDate:'',maxDate:'',time:'20:00',candidates:[],selectedIds:[]},
  onLoad(options={}){this._initialHabit=options.habitId;this._initialRelation=options.relationId;const date=ui.date.today();let selectedDate=date;try{ui.date.assertDate(options.date);if(options.date>=date&&options.date<=ui.date.shift(date,7))selectedDate=options.date;}catch(_){}this.setData({modern:true,type:options.type==='supervisor'?'supervisor':'self',businessDate:selectedDate,minDate:date,maxDate:ui.date.shift(date,7)});},
  refresh(){
    work.resetOnContext(this,()=>{this._preview=null;this._authorized=null;this._selectionEdited=false;this._timeEdited=false;this.setData({preview:null,items:[],retrySchedule:false,candidates:[],selectedIds:[]});});
    this.setData({enabled:features().status().reminders,busy:!!this._featureBusy});ui.read(this,()=>{});
  },
  async onShow(){
    const version=this._showVersion;
    try{await Promise.resolve(getApp().dataReady);}catch(_){/* 核心读取失败由页面恢复入口处理。 */}
    if(this._gone||this._visible===false||this._showVersion!==version)return;
    this.refresh();if(this.data.enabled&&this.data.dataReady){await this.load();if(this.data.modern)this.loadCandidates();}
  },
  load(){return work.run(this,s=>s.reminders(this.data.modern?{includeTypes:true}:undefined),items=>this.showItems(items));},
  showItems(items){this.setData({items:items.map(item=>({...item,sendDate:new Date(Date.parse(item.dueAt)+8*3600000).toISOString().slice(0,10),key:(item.type||'self')+':'+item.businessDate,label:LABELS[item.status],canCancel:item.status==='pending'}))});},
  clearPreview(){this._preview=null;this._authorized=null;this.setData({preview:null,retrySchedule:false,error:''});},
  async loadCandidates(){
    if(this.data.retrySchedule)return;
    const context=ui.contextKey(),version=this._showVersion,type=this.data.type,date=this.data.businessDate;
    try{
      let candidates=[];
      if(type==='self')candidates=ui.domain.tasksOn(ui.store().read(),date).filter(task=>!task.done).map(task=>({id:task.id,title:task.title,time:task.time}));
      else if(supervision().status().enabled){const result=await supervision().list();candidates=result.items.filter(item=>item.role==='supervisor'&&['active','scheduled'].includes(item.status)&&date>=item.startDate&&date<=item.endDate&&(!item.habitPlan||item.habitPlan.weekdays.includes(ui.date.weekday(date)))).map(item=>({id:item.supervisionId,title:item.title,deadline:item.pendingRules&&item.pendingRules.effectiveDate<=date?item.pendingRules.deadline:item.rules.deadline}));}
      if(!ui.isCurrentView(this,context,version)||type!==this.data.type||date!==this.data.businessDate)return;
      const initial=type==='self'?this._initialHabit:this._initialRelation;
      const selectedIds=this._selectionEdited||this.data.selectedIds.length?this.data.selectedIds.filter(id=>candidates.some(item=>item.id===id)):initial?candidates.filter(item=>item.id===initial).map(item=>item.id):candidates.map(item=>item.id);
      const time=this._timeEdited?this.data.time:this.defaultTime(candidates,selectedIds);
      if(this._preview&&(time!==this.data.time||JSON.stringify(selectedIds)!==JSON.stringify(this.data.selectedIds)))this.clearPreview();
      this.setData({candidates:candidates.map(item=>({...item,selected:selectedIds.includes(item.id)})),selectedIds,time});
    }catch(err){if(ui.isCurrentView(this,context,version))ui.error(this,err);}
  },
  defaultTime(candidates,selectedIds){const selected=candidates.filter(item=>selectedIds.includes(item.id));if(this.data.type==='self'){const times=selected.map(item=>item.time).filter(Boolean).sort();return times[0]||'20:00';}if(!selected.length)return '21:15';const deadline=selected.reduce((max,item)=>item.deadline>max?item.deadline:max,'00:00'),minutes=Number(deadline.slice(0,2))*60+Number(deadline.slice(3))+15;return String(Math.floor(minutes/60)%24).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');},
  onType(event){if(this._featureBusy||this.data.retrySchedule)return;this._selectionEdited=false;this._timeEdited=false;this.clearPreview();this.setData({type:event.currentTarget.dataset.type,candidates:[],selectedIds:[]});this.loadCandidates();},
  onDate(event){if(this._featureBusy||this.data.retrySchedule)return;this._selectionEdited=false;this._timeEdited=false;this.clearPreview();this.setData({businessDate:event.detail.value,selectedIds:[]});this.loadCandidates();},
  onTime(event){if(this._featureBusy||this.data.retrySchedule)return;this._timeEdited=true;this.clearPreview();this.setData({time:event.detail.value});},
  onCandidate(event){if(this._featureBusy||this.data.retrySchedule)return;this._selectionEdited=true;const id=event.currentTarget.dataset.id,selectedIds=this.data.selectedIds.includes(id)?this.data.selectedIds.filter(value=>value!==id):this.data.selectedIds.concat(id);this.clearPreview();this.setData({selectedIds,candidates:this.data.candidates.map(item=>({...item,selected:selectedIds.includes(item.id)})),time:this._timeEdited?this.data.time:this.defaultTime(this.data.candidates,selectedIds)});},
  onRefresh(){return this.load();},
  onSlot(event){if(this._featureBusy)return;this._preview=null;this._authorized=null;this.setData({slotIndex:Number(event.detail.value),preview:null,retrySchedule:false,error:''});},
  onPreview(){if(this.data.retrySchedule)return;if(this.data.modern&&!this.data.selectedIds.length){this.setData({error:'先选择要提醒的事项'});return;}const input=this.data.modern?{type:this.data.type,businessDate:this.data.businessDate,slot:this.data.time,[this.data.type==='self'?'habitIds':'relationIds']:this.data.selectedIds}:this.data.slots[this.data.slotIndex];return work.run(this,s=>s.reminderPreview(input),p=>{this._preview=p;this._authorized=null;this.setData({preview:{businessDate:p.businessDate,sendDate:new Date(Date.parse(p.dueAt)+8*3600000).toISOString().slice(0,10),slot:p.slot,type:p.type,items:(p.items||[]).map(item=>({...item,key:item.relationId||item.habitId}))},retrySchedule:false});});},
  onSubscribe(){
    if(this._featureBusy||!this._preview)return;
    let key;
    try{ui.assertContext(this);key=features().contextKey();if(key!==this._preview.context)throw Error('账户数据已变化，请重新预览');}
    catch(err){ui.error(this,err);return;}
    if(typeof wx.requestSubscribeMessage!=='function'){this.setData({error:'当前微信版本不支持订阅提醒，仍可正常打卡'});return;}
    const preview=this._preview;this._featureBusy=true;this.setData({busy:true,error:''});
    const context=ui.contextKey(),version=this._showVersion;
    // Must be called synchronously from the user's tap, not after an await/network request.
    try{wx.requestSubscribeMessage({tmplIds:[preview.templateId],
      success:async result=>{
        try{
          if(!ui.isCurrentView(this,context,version)||features().contextKey()!==key||this._preview!==preview)return;
          if(result[preview.templateId]!=='accept'){this.setData({error:'未申请提醒，打卡不受影响'});return;}
          this._authorized=preview;await this.saveAuthorized(key,context,version);
        }catch(err){if(ui.isCurrentView(this,context,version))ui.error(this,err);}finally{this.release();}
      },
      fail:()=>{if(ui.isCurrentView(this,context,version))this.setData({error:'未取得订阅授权，未申请提醒'});this.release();}
    });}catch(_){this.release();this.setData({error:'当前暂不能申请订阅提醒'});}
  },
  async saveAuthorized(key,context,version){
    const preview=this._authorized;if(!preview)return;
    try{
      const result=await features().scheduleReminder(preview);
      if(!ui.isCurrentView(this,context,version)||features().contextKey()!==key)return;
      this._preview=null;this._authorized=null;this.setData({preview:null,retrySchedule:false});
      const items=this.data.items.filter(i=>i.businessDate!==result.businessDate||(i.type||'self')!==(result.type||'self')).concat(result).sort((a,b)=>a.businessDate.localeCompare(b.businessDate));this.showItems(items);
    }catch(err){
      if(!ui.isCurrentView(this,context,version)||features().contextKey()!==key)return;
      if(['PREVIEW_CHANGED','RECONFIRM_REQUIRED','EPOCH_CHANGED','CONFLICT'].includes(err.code)) {
        this._preview=null;this._authorized=null;this.setData({preview:null,retrySchedule:false,error:'计划或提醒状态已变化，请重新预览并授权'});
      }else this.setData({retrySchedule:true,error:'登记结果尚未确认，可刷新状态或重试登记；不会再次申请授权'});
    }
  },
  async onRetrySchedule(){
    if(this._featureBusy||!this._authorized)return;
    this._featureBusy=true;this.setData({busy:true,error:''});
    const context=ui.contextKey(),version=this._showVersion;
    try{ui.assertContext(this);await this.saveAuthorized(features().contextKey(),context,version);}catch(err){if(ui.isCurrentView(this,context,version))ui.error(this,err);}finally{this.release();}
  },
  release(){this._featureBusy=false;if(!this._gone)this.setData({busy:false});},
  onCancel(event){
    const item=this.data.items.find(i=>i.businessDate===event.currentTarget.dataset.date&&(!event.currentTarget.dataset.type||(i.type||'self')===event.currentTarget.dataset.type));if(!item||this._featureBusy)return;
    return work.run(this,s=>s.cancelReminder(item),result=>this.showItems(this.data.items.map(i=>i.businessDate===result.businessDate&&(i.type||'self')===(result.type||'self')?result:i)));
  },
}));
