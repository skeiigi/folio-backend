const ref=name=>({$ref:`#/components/schemas/${name}`});
const json=schema=>({'application/json':{schema}});
const response=(description,schema)=>({description,...(schema?{content:json(schema)}:{})});
const operation=(summary,roles,request,schema,status='200')=>({summary,security:roles.includes('guest')?[]:[{bearerAuth:[]}],'x-roles':roles,...(request?{requestBody:{required:true,content:json(request)}}:{}),responses:{[status]:response('Успешный результат',schema),'401':response('Требуется авторизация'),'403':response('Недостаточно прав'),'422':response('Ошибка проверки данных')}});
const briefInput={type:'object',required:['authorProfileId','title','description','budgetRange'],properties:{authorProfileId:{type:'string',format:'uuid'},title:{type:'string',minLength:3},description:{type:'string',minLength:20},budgetRange:ref('MoneyRange'),desiredDeadline:{type:['string','null'],format:'date'}}};
const idParameter={name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}};
const fileUpload={type:'object',properties:{file:{type:'string',format:'binary'},purpose:{type:'string',enum:['cover','preview','model']}},required:['file']};
export const openapi={
  openapi:'3.1.0',info:{title:'Folio API',version:'1.0.0',description:'Контракт Folio по ПР03. Все закрытые операции проверяют роль и владельца ресурса.'},servers:[{url:'/api/v1'}],
  components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'}},schemas:{
    MoneyRange:{type:'object',properties:{min:{type:'number',minimum:0},max:{type:'number',minimum:0},currency:{type:'string',enum:['RUB','USD','EUR']}},required:['min','max','currency']},
    Brief:{...briefInput,properties:{...briefInput.properties,id:{type:'string',format:'uuid'},clientUserId:{type:'string',format:'uuid'},status:{type:'string',enum:['submitted','in_discussion','accepted','in_progress','completed','rejected','cancelled']},createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'},attachments:{type:'array',items:ref('MediaFile')}}},
    MediaFile:{type:'object',properties:{id:{type:'string',format:'uuid'},purpose:{type:'string'},fileName:{type:'string'},mimeType:{type:'string'},sizeBytes:{type:'integer'}}},
    Artwork:{type:'object',properties:{id:{type:'string',format:'uuid'},authorProfileId:{type:'string',format:'uuid'},title:{type:'string'},description:{type:'string'},workType:{type:'string',enum:['model3d','illustration','animation','other']},style:{type:'string'},technicalDetails:{type:'object'},status:{type:'string',enum:['draft','published','archived']},media:{type:'array',items:ref('MediaFile')}}},
  }},
  paths:{
    '/auth/register':{post:operation('Регистрация заказчика или автора',['guest'],{type:'object',properties:{name:{type:'string'},email:{type:'string',format:'email'},password:{type:'string',minLength:10},role:{enum:['client','author']}}},{type:'object'},'201')},
    '/auth/login':{post:operation('Вход',['guest'],{type:'object',properties:{email:{type:'string'},password:{type:'string'}}},{type:'object'})},
    '/auth/me':{get:operation('Текущий пользователь',['client','author','admin'],null,{type:'object'})},
    '/artworks':{get:operation('Каталог: q, workType, style, page, limit',['guest'],null,{type:'object'}),post:operation('Сохранить черновик работы',['author','admin'],ref('Artwork'),ref('Artwork'),'201')},
    '/artworks/{id}':{parameters:[idParameter],get:operation('Публичная работа или собственный черновик',['guest'],null,ref('Artwork')),patch:operation('Изменить или опубликовать свою работу',['author','admin'],{type:'object'},ref('Artwork')),delete:operation('Архивировать свою работу',['author','admin'],null,null,'204')},
    '/artworks/{id}/media':{parameters:[idParameter],post:{...operation('Добавить обложку, превью или GLB',['author','admin'],null,ref('MediaFile'),'201'),requestBody:{content:{'multipart/form-data':{schema:fileUpload}}}}},
    '/creators':{get:operation('Поиск публичных авторов',['guest'],null,{type:'object'})},
    '/creators/{id}':{parameters:[idParameter],get:operation('Профиль, портфолио и услуги',['guest'],null,{type:'object'}),patch:operation('Изменить свой профиль и оформление',['author','admin'],{type:'object'},{type:'object'})},
    '/creator-profiles':{post:operation('Создать свой профиль автора',['author','admin'],{type:'object'},{type:'object'},'201')},
    '/services':{post:operation('Добавить услугу',['author','admin'],{type:'object'},{type:'object'},'201')},
    '/services/{id}':{parameters:[idParameter],patch:operation('Изменить услугу',['author','admin'],{type:'object'},{type:'object'}),delete:operation('Скрыть услугу',['author','admin'],null,null,'204')},
    '/briefs':{post:operation('Отправить бриф; clientUserId определяется по токену',['client','admin'],briefInput,ref('Brief'),'201')},
    '/me/briefs':{get:operation('Свои брифы: side=sent|received, status, page, limit',['client','author','admin'],null,{type:'object'})},
    '/briefs/{id}':{parameters:[idParameter],get:operation('Бриф, его референсы и история; только участники',['client','author','admin'],null,ref('Brief')),patch:operation('Редактирование заказчиком до принятия',['client','admin'],{type:'object'},ref('Brief'))},
    '/briefs/{id}/status':{parameters:[idParameter],patch:operation('Изменить статус по допустимому переходу',['client','author','admin'],{type:'object',properties:{status:{type:'string'},message:{type:'string'}}},ref('Brief'))},
    '/briefs/{id}/attachments':{parameters:[idParameter],post:{...operation('Прикрепить референс к своему редактируемому брифу',['client','admin'],null,ref('MediaFile'),'201'),requestBody:{content:{'multipart/form-data':{schema:fileUpload}}}}},
    '/briefs/{id}/attachments/{fileId}':{parameters:[idParameter,{...idParameter,name:'fileId'}],delete:operation('Удалить свой референс до принятия',['client','admin'],null,null,'204')},
    '/media/{id}/content':{parameters:[idParameter],get:{summary:'Файл: публичное превью или закрытый референс для участников',responses:{'200':{description:'Бинарное содержимое'},'206':{description:'Диапазон байтов'},'401':{description:'Референс закрыт'}}}},
  },
};
