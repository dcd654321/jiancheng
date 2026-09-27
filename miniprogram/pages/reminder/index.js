const ui=require('../../services/ui');
const {features}=require('../../services/features-client');
const work=require('../../services/feature-page');
const LABELS={pending:'已申请，等待发送',claimed:'正在处理，不能撤回在途消息',sent:'平台已接受发送请求',cancelled:'已取消／不再需要发送',failed:'未发送',unknown:'发送未确认，不会自动重发'};
Page(ui.withLifecycle({
  data:{enabled:false,loading:true,needsConsent:false,dataReady:false,dataUnavailable:false,error:'',busy:false,slots:['08:00','12:30','20:30'],slotIndex:2,preview:null,items:[],retrySchedule:false},
  refresh(){
    work.resetOnContext(this,()=>{this._preview=null;this._authorized=null;this.setData({preview:null,items:[],retrySchedule:false});});
    this.setData({enabled:features().status().reminders,busy:!!this._featureBusy});ui.read(this,()=>{});
  },
  async onShow(){await Promise.resolve(getApp().dataReady);if(this._visible&&!this._gone&&this.data.enabled&&this.data.dataReady)this.load();},
  load(){return work.run(this,s=>s.reminders(),items=>this.showItems(items));},
  showItems(items){this.setData({items:items.map(item=>({...item,label:LABELS[item.status],canCancel:item.status==='pending'}))});},
  onRefresh(){return this.load();},
  onSlot(event){if(this._featureBusy)return;this._preview=null;this._authorized=null;this.setData({slotIndex:Number(event.detail.value),preview:null,retrySchedule:false,error:''});},
  onPreview(){if(this.data.retrySchedule)return;return work.run(this,s=>s.reminderPreview(this.data.slots[this.data.slotIndex]),p=>{this._preview=p;this._authorized=null;this.setData({preview:{businessDate:p.businessDate,slot:p.slot},retrySchedule:false});});},
  onSubscribe(){
    if(this._featureBusy||!this._preview)return;
    let key;
    try{ui.assertContext(this);key=features().contextKey();if(key!==this._preview.context)throw Error('账户数据已变化，请重新预览');}
    catch(err){ui.error(this,err);return;}
    if(typeof wx.requestSubscribeMessage!=='function'){this.setData({error:'当前微信版本不支持订阅提醒，仍可正常打卡'});return;}
    const preview=this._preview;this._featureBusy=true;this.setData({busy:true,error:''});
    // Must be called synchronously from the user's tap, not after an await/network request.
    try{wx.requestSubscribeMessage({tmplIds:[preview.templateId],
      success:async result=>{
        try{
          if(this._gone||!this._visible||features().contextKey()!==key||this._preview!==preview)return;
          if(result[preview.templateId]!=='accept'){this.setData({error:'未申请提醒，打卡不受影响'});return;}
          this._authorized=preview;await this.saveAuthorized(key);
        }catch(err){if(!this._gone&&this._visible)ui.error(this,err);}finally{this.release();}
      },
      fail:()=>{if(!this._gone&&this._visible)this.setData({error:'未取得订阅授权，未申请提醒'});this.release();}
    });}catch(_){this.release();this.setData({error:'当前暂不能申请订阅提醒'});}
  },
  async saveAuthorized(key){
    const preview=this._authorized;if(!preview)return;
    try{
      const result=await features().scheduleReminder(preview);
      if(this._gone||!this._visible||features().contextKey()!==key)return;
      this._preview=null;this._authorized=null;this.setData({preview:null,retrySchedule:false});
      const items=this.data.items.filter(i=>i.businessDate!==result.businessDate).concat(result).sort((a,b)=>a.businessDate.localeCompare(b.businessDate));this.showItems(items);
    }catch(err){
      if(this._gone||!this._visible||features().contextKey()!==key)return;
      if(['PREVIEW_CHANGED','RECONFIRM_REQUIRED','EPOCH_CHANGED','CONFLICT'].includes(err.code)) {
        this._preview=null;this._authorized=null;this.setData({preview:null,retrySchedule:false,error:'计划或提醒状态已变化，请重新预览并授权'});
      }else this.setData({retrySchedule:true,error:'登记结果尚未确认，可刷新状态或重试登记；不会再次申请授权'});
    }
  },
  async onRetrySchedule(){
    if(this._featureBusy||!this._authorized)return;
    this._featureBusy=true;this.setData({busy:true,error:''});
    try{ui.assertContext(this);await this.saveAuthorized(features().contextKey());}catch(err){ui.error(this,err);}finally{this.release();}
  },
  release(){this._featureBusy=false;if(!this._gone)this.setData({busy:false});},
  onCancel(event){
    const item=this.data.items.find(i=>i.businessDate===event.currentTarget.dataset.date);if(!item||this._featureBusy)return;
    return work.run(this,s=>s.cancelReminder(item),result=>this.showItems(this.data.items.map(i=>i.businessDate===result.businessDate?result:i)));
  },
  onStart(){wx.navigateTo({url:'/pages/sync/index'});}
}));
