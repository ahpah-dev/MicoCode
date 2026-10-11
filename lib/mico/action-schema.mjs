// Share the same bounded action protocol with browser and native local models.
// One bounded action per reply leaves room for a complete exact edit.
const path={type:'string'};
const action=(type,properties={},required=[])=>({type:'object',additionalProperties:false,properties:{type:{const:type},...properties},required:['type',...required]});
export const actionSchema={
 type:'object',additionalProperties:false,
 properties:{
  message:{type:'string',maxLength:2000},
  actions:{type:'array',maxItems:1,items:{oneOf:[
   action('read_file',{path},['path']),
   action('read_file',{path,startLine:{type:'integer',minimum:1},endLine:{type:'integer',minimum:1}},['path','startLine','endLine']),
   action('edit_file',{path,find:{type:'string',minLength:1,maxLength:50000},replace:{type:'string',maxLength:150000}},['path','find','replace']),
   action('write_file',{path,content:{type:'string',maxLength:150000}},['path','content']),
   action('delete_file',{path},['path']),
   action('search',{query:{type:'string',minLength:1,maxLength:200}},['query']),
   action('list_files'),action('check_project'),action('review_quality'),
   action('publish',{target:{type:'string',enum:['github','vercel','netlify','custom']},repo:{type:'string',maxLength:100},message:{type:'string',maxLength:200}}),
   action('git',{command:{type:'string',enum:['status','commit','push','pull','init','log','branch','diff']},message:{type:'string',maxLength:500}}),
  ]}},
  done:{type:'boolean'},
 },required:['message','actions','done'],
};
