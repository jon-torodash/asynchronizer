Asynchronizer = {
   //functionRegistry stores the async data for all functions processed.
   //It is an array to assure quick lookup.
   //Object properties:
   //               {key : top_caller1_caller2...callerN_functionName,
   //               substeps : [functionized loops (named with above + _i)],
   //               ipa : [numbers - as many as above]
   //               }
   functionRegistry : [],
   
   testDeclaration : function(line){
      return line.search(/var\s+.+?=.+/) !== -1;
   },
   
   hasTimer : true,
   
   getDeclarations : function(line){
      var vars = line.match(/var\s+.+?=/g);
      var size = vars.length, v, i ,j, size2;
      var declarations = '';
      for(i=0; i<size; i++){
         v = vars[i];
         //Clear the var declaration, split along possible delimiters, extract LHS, concat.
         v = v.replace(/var\s+/g,'');
         v = v.split(/,|;/);
         var size2 = v.length;
         for(j=0; j<size2; j++){
            declarations += ','+v[j].split('=')[0];
         }
      }
      return declarations.substring(1)+';'; //remove leading comma
   },
   
   thefunc : null,
   
   activeCall : null, //holds the current timeout. (This will probably need to be an array of a more complex structure)

   
   initTimestamp : new Date().getTime(), // For scope chain hashing function names
   
   childProcessCall : function(proc){
       if(top.setTimeout) //Browser
       {
           return 'top.setTimeout(' + proc + ', 0)'
       }
       else if(top.child_process) //node.js
       {
           return 'top.child_process';
       }
       else
       {
           return undefined;
       }
   }
};
 
      
               
   // function performScan(input)
   // {
      // var topLevel = {contents : [], type : 'globalObj'};
      // scan(input,topLevel);
      // return topLevel.contents;
   // }
               
  function scan(input,activeScope)
  {
     var token = []
     var token = '';
     var updated;
     var size = input.length;
     for(var inputPointer=0; inputPointer<size; inputPointer++){
        token += input[inputPointer];
        updated = process(inputPointer,input,token,activeScope);
        inputPointer = updated.iPointer;
        token = updated.raw;
     }
     //Finish the remaining token. Should be plainline.
     process(inputPointer,input,token,activeScope);
     return activeScope;
  }



function process(inputPointer,input,token,activeScope)
  {

      
     var result = tokenize(token);
     
     if(result != null){
        switch(result){
           case 'function':
             var func = standardize(token,input,'function');
             activeScope.contents.push(func.data);
                      func.data.outer = activeScope;
             scan(func.data.content,func.data); //Recurse
             inputPointer = func.newPos;
             //delete func.data.content;
         break;
            case 'forLoop':
             var forLoop = standardize(token,input,'forLoop');
                      forLoop.data.outer = activeScope;
             activeScope.contents.push(forLoop.data);
             scan(forLoop.data.content,forLoop.data); //Recurse
             inputPointer = forLoop.newPos;
             //delete forLoop.data.content;
         break;
          case 'plainline': //This is the default. Must be last case or else will match most prior tokens
             //Ignore trim-worthy things
             if(!isBlank(token)){
                var plainline = standardize(token,input,'plainline');
                activeScope.contents.push(plainline.data);
                inputPointer = plainline.newPos;
             }
         break;
        }
        //Position in the scan loop necessitates storing part of the raw remainder for subsequent scanning. Refactor later.
        token = input[inputPointer];
     }
 
     return {iPointer : inputPointer, raw : token};
  }
 
 
    function asynchronize(input){
               
      if(input.type != 'Func')
      {
         throw {message: 'asynchronize called can only be called on a Func object', problem: input}
      }
      //Builder
      var funcBody = '';
      var func_step = 0; //Keeps track of topological ordering.
                  
      //Hold data for function. This object will be serialized after creation and then parsed in the script content re-write.
      var AsyncData = {substeps : [], ipa_list: []};
                  
      //TODO: set this dynamically.
      //Determine scope chain and function name for library global storage hash.
      var scope_chain_hash = input.getScopeChainHash();
      AsyncData.key = scope_chain_hash;
                  
      //Why do it this way? If keep as is, we can deal with functions by assignment as well: will need separate handling
      //in functionRegistry assignment, however.
                  
      //Extract signature, without name, and collect parameters for new function construction.
      //var s_index = input.sig.search('function') + 8;
      //var sig_sub = input.sig.substring(s_index);
      //var sig_remainder = sig_sub.match(/\s*\(.*\)\s*/)[0];
      var sig_remainder = input.sig;
                  
      //funcBody += 'function '+sig_remainder+'\n{\n';
      funcBody += sig_remainder+'\n{\n';
                  
                  
      /* Cannot use this for Function constructor because of closure issue. See:
      https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Function
                  
      sig_remainder = sig_remainder.substr(1,sig_remainder.length-2);
      //First arguments for builder. Will need to be split into parameters.
      var args = sig_remainder.split(',');
      */
                  
      //Asynchronize the function
      //This is kept internal for closure access to vars above.
      var handle_contents = function(wrapper)
      {
         var func_innards = '';
         var innerFuncDefs = '';
         var declarations = '';
         var indent = '\t';
         var funcDataPosition, async_data;
         var size = wrapper.contents.length;
         for(var i=0; i<size; i++){
            var element = wrapper.contents[i];
            switch(element.type){
               case 'Plainline' :
                  func_innards += indent+element.content;
                  break;
               case 'ForLoop' :
                  var seq = ++func_step;
                  //Close off sequential plain line statements from prior post-forloop return if there are more than 1. in the function
                  if(seq > 1){
                     func_innards += '\t}';
                     indent = '\t';
                  }
                  //AsyncData.sub_functions.length may be extended in loop_to_func recursion, but this is correct for nested -> sequential.
                  var innerFunc = loop_to_func(element,scope_chain_hash,seq,scope_chain_hash+'_ipa');
                  innerFuncDefs = indent+innerFunc.f_func+'\n';
                  //Push the outer function into the registry. It only needs to keep track of its substeps (in first release, at any rate).
                  funcDataPosition = Asynchronizer.functionRegistry.length;
                  async_data = {finishedStep: 0};
                  Asynchronizer.functionRegistry.push(async_data);
                  declarations += indent+innerFunc.var_decl;
                  //func_innards += '{\n'+innards+'\n}';
                  func_innards += indent+innerFunc.f_call+'\n';
                  //Setup catch for sequential code that followed the loop. func_step should be topologically incremented to the ending spot
                  func_innards += indent+'if(Asynchronizer.functionRegistry.finishedStep == '+func_step+'){\n';
                  //Reset for next call
                  func_innards += indent+'\t'+'Asynchronizer.functionRegistry.finishedStep = '+0+';\n';
                  indent = '\t\t';
                  break;
               case 'Func' :
                  break;
            }
         }
         //Close off sequential statements after last forLoop conversion
         if(seq > 0)
            func_innards += '\t}\n';
         //declarations = (declarations.replace(/\t/g,'') === '') ? '' : declarations+';\n';
         funcBody += innerFuncDefs + declarations + func_innards;
         funcBody += '}';
      }
                  
      //Helper for prior function: structured as function to benefit from recursion for inner loops
      var loop_to_func = function (forloop,scope_chain_hash,seq)
      {
         //No special hashing needed to retrieve the info from the main functionRegistry: just hard code it.
         var funcDataPosition = Asynchronizer.functionRegistry.length;
         var async_data = {lastCalled: 0, ipa: 0, maxLockTime: 200, converged: false, freshCall: true};
         Asynchronizer.functionRegistry.push(async_data);
         var f_data_var = scope_chain_hash+'_'+seq+'_data'; //helper object's name within the associated function.
         //Name for funced loop: will follow depth-first
         var func_name = scope_chain_hash+'_'+seq;
         var f_call; //Plainline call to the function.
         var f_func; //function created from forLoop body.
                     
         //For tuning
         var timer_var_name = scope_chain_hash+'_'+seq+'_timer';
                     
         //For formatting: (maybe make this optional)
         var indent = '';
         for(var i=0; i<seq+1; i++)
            indent += '\t';
         //will be needed for the outer function to assure closure across other functionized loops at the same function scope.
         var f_declarations = '';
         var sig = forloop.sig;
         //Parse the parts of the loop
         var start = sig.indexOf('for('), end = sig.lastIndexOf(')');
         sig = sig.substring(start+4,end);
         var statements = sig.split(';');
         //Capture declarations made in the init statement: variable decl. must be done in the outer context.
         if(Asynchronizer.testDeclaration(statements[0])){
            f_declarations += Asynchronizer.getDeclarations(statements[0]);
         }
         //Sig
         f_func = 'function '+func_name+'('+f_data_var+')\n';
         //Opening: go back one tab
         f_func += indent.substring(1)+'{\n';
         //Timing caliper or ipa set.
         var curr_ipa_var = scope_chain_hash+'_'+seq+'_ipa_curr';
         var ipa_var_name = scope_chain_hash+'_'+seq+'_ipa';
         //Set init conditions
         f_func += indent+'if('+f_data_var+'.converged === false)\n';
         f_func += indent+'{\n';
         if(Asynchronizer.hasTimer){
            f_func += indent+'\tvar '+timer_var_name+' = new Date().getTime();\n';
            f_func += indent+'\tif('+timer_var_name+' - '+f_data_var+'.lastCalled > '+async_data.maxLockTime+')\n';
            f_func += indent+'\t'+f_data_var+'.lastCalled = '+timer_var_name+';\n';
         }
         f_func += indent+'}\n';
         f_func += indent+'else\n';
         f_func += indent+'{\n';
         f_func += indent+'\t'+ipa_var_name+' = '+f_data_var+'.ipa;\n';
         f_func += indent+'}\n';
         //Check whether to set initial condition on this entry
         f_func += indent+'if('+f_data_var+'.freshCall === true)\n';
         f_func += indent+'{\n';
         f_func += indent+'\t'+f_data_var+'.freshCall = false;\n';
         f_func += indent+'\t'+(statements[0])+';\n';
         f_func += indent+'}\n';
         //Reconstruction of the forLoop: user submitted condition && iterations per async within limit.
                     
         f_func += indent+'for('+curr_ipa_var+' = 0;'+(statements[1])+' && '+(curr_ipa_var+' < '+ipa_var_name)+'; '+statements[2]+', '+curr_ipa_var+'++)\n';
         f_func += indent+'{\n';
         var size = forloop.contents.length;
         for(var l = 0; l < size; l++){
            var line = forloop.contents[l];
            if(line.type == 'Plainline'){
               f_func += indent+'\t'+line.content;
               //variable decl. must be done in the outer context.
               if(Asynchronizer.testDeclaration(line.content)){
                  f_declarations += Asynchronizer.getDeclarations(line.content);
               }
            }
            else if(line.type == 'ForLoop'){
               var position = ++func_step;
               //Recursive call.
               var innerFunc = loop_to_func(line,scope_chain_hash,position,ipa_var_name);
               AsyncData.sub_functions.push(innerFunc.f_func);
               AsyncData.ipa_list.push(null)
               f_func += '\t'+innerFunc.f_call;
               //f_func += '\n}';
            }
         }
         //Clean up declarations if it's more than just tabs.
         if(f_declarations.search(/[^\t]/) !== -1) f_declarations = 'var '+ f_declarations + '\n';
         f_func += indent+'}\n';
         //Check condition
         f_func += indent+'if('+(statements[1])+')\n';
         f_func += indent+'{\n';
         f_func += indent+'\tAsynchronizer.activeCall = setTimeout(function(){'+func_name+'('+f_data_var+');},'+timer_var_name+')\n';
         f_func += indent+'\treturn;\n'
         f_func += indent+'}\n';
         //Closing: go back one tab
         f_func += indent.substring(1)+'}';
         //For caller:
         f_call = func_name+'();';
         return {'f_name' : func_name, 'f_call' : f_call, 'f_func' : f_func, 'var_decl' : f_declarations};
      }
                  
      handle_contents(input);
                  
       
      console.log(funcBody);
                  
                  
      //Storing in the registry will be done in the caller.
      return '\n'+funcBody;
    }
    
               
 

     
      
      
      
      
      

 
   function standardize(token,input,type){
      var ret, callerIteratorPosition=0;
      switch(type){
      case 'function':
         ret = new Func();
         var start = input.indexOf(token);
         //Get signature
         var paramListLevel = 1, iter = start + token.length;
         while(paramListLevel != 0){
            if(iter > input.length)
               throw {message: "Function parameter list not well formed", problem: input}
            iter++;
            if(input.charAt(iter) == ')')
               paramListLevel--;
            else if(input.charAt(iter) == '(')
               paramListLevel++;
         }
         callerIteratorPosition += iter;
         //Clean up sig
         ret.sig = input.substring(start,iter+1).replace(/\s{2,}/g,'')//.replace(/\n{2,}/g,'\n');
         //Needed? Just extract sig more creatively.
         //Determine name: clear 'function' and params. Will need to consider function as an assignment also if that is all \s*
         //ret.name = ret.sig.substring(ret.sig.match(/function\s*/)[0].length,ret.sig.search(/\(/));
         //Find body beginning
         var rest = input.substring(iter);
         iter = rest.indexOf('{');
         var bodyBeginPos = iter+1;
         level = 1;
         while(level != 0){
            if(iter > rest.length)
               throw {message: "Function body not well formed", problem: input}
            iter++;
            if(rest.charAt(iter) == '}')
               level--;
            else if(rest.charAt(iter) == '{')
               level++;
         }
         callerIteratorPosition += iter+1; //+1 for opening bracket
         ret.content = rest.substring(bodyBeginPos,iter).replace(/\s{2,}/g,'\n'); //.replace(/\n{2,}/g,' ')
         break;
      case 'forLoop':
         ret = new ForLoop();
         var start = input.indexOf(token);
         //Get signature.
         var paramListLevel = 1, iter = start + token.length, semicols = 0;
         while(paramListLevel != 0){
            if(iter == input.length && semicols != 2)
               throw {message: "For loop parameter list not well formed", problem: input}
               iter++;
            switch(input.charAt(iter)){
               case ')': paramListLevel--; break;
               case '(': paramListLevel++; break;
               case ';': semicols++; break;
            }
         }
         callerIteratorPosition += iter;
         ret.sig = input.substring(start,iter+1).replace(/\s{2,}/g,' ');
         //Determine whether braced or not, and fix if not
         var rest = input.substring(iter+2);
         if(rest.indexOf('{') == -1 || rest.indexOf('{') > rest.search(/\S/)){
           var statement_end = rest.search(/[\n;]/);
           rest = '{'+rest.substring(0,statement_end+1)+'}';
         }
         //Find body beginning
         iter = 0;
         var bodyBeginPos = iter+1;
         level = 1;
         while(level != 0){
         if(iter > rest.length)
            throw {message: "For loop body not well formed", problem: input}
         iter++;
         if(rest.charAt(iter) == '}')
            level--;
         else if(rest.charAt(iter) == '{')
            level++;
         }
         callerIteratorPosition += iter+1; //+1 for expr. terminator?
         ret.content = rest.substring(bodyBeginPos,iter).replace(/\s{2,}/g,'\n');
         break;
      case 'plainline':
         ret = new Plainline();
         /* Taking this out because JS finds the statement terminator better on its own.
         var semicolon = token.charAt(token.length-1) == ';' ? '' : ';'
         ret.content = token + semicolon;
         */
         if(token.charAt(0) == '\n')
            token = token.substring(1);
         if(token.charAt(token.length-1) != '\n')
            token += '\n';
         ret.content = token;
         ret.sig = '(plainline)'
         var callerIteratorPosition = input.indexOf(token) + token.length;
         break;
      }
      return  {data: ret, newPos: callerIteratorPosition};
   }
 
      //Classes. Expression is abstract base.
   function Expression(content)
   {
      this.type = 'Expression';
      this.body = (typeof content != 'string') ? '' : content
   }
 
   function ForLoop(content, sig, braced)
   {
      Expression.apply(this, arguments);
      this.loop_vars = sig.split(',');
      this.braced = braced;
      this.baseIndentation;
      this.currentIndentation = 0;
      this.getIndent = function()
      {
          var temp = this.baseIndentation + this.currentIndentation, indent = '';
          while(temp--) indent += '\t';
          return indent;
      }
      this.body = scanBody(content);
      this.hash = hashCode(content);
      
      this.CPSForm = 'function ' + this.hash + '(cont_' + this.hash + ')\n{';
      this.CPSForm += 'var caliper_'+this.hash + '= new Date();';
      this.CPSForm += 'for(' + 'Asynchronizer.registry.' + this.hash + '.get_init_params()' + ',' +this.loop_vars[1] + ',' + this.loop_vars[2] + ')';
      this.CPSForm += 'if(new Date() - caliper_'+this.hash + '>= Asynchronizer.registry.' + this.hash + '.maxTime)\n{';
      this.CPSForm += 'Asynchronizer.registry.' + this.hash + '.timer = ' + Asynchornizer.childProcessCall('cont_' + this.hash) + ';\nreturn;';
      this.CPSForm += '}\n';
      this.CPSForm += this.body.join('\n');
      this.CPSForm += '\n}';
      
      this.toString = function(){ return this.CPSForm; };
      
      this.toCPSFunc = function()
      {
          return (new Function('return ' + this.toString() + ')();'))();
      }
      
   }
   ForLoop.prototype = new Expression();
    
   function Plainline(content)
   {
      Expression.apply(this, arguments);
      this.type = 'Plainline';
   }
   Plainline.prototype = new Expression();
   Plainline.prototype.constructor = Plainline;
   
   function PlainlinePlus(content, tada)
   {
       Plainline.apply(this, arguments);
       this.tada = tada;
       this.type = 'PlainlinePlus';
   }
   PlainlinePlus.prototype = new Plainline();
   PlainlinePlus.prototype.constructor = PlainlinePlus;
 
    function FuncDissected(func)
   {
       if(typeof func === 'string')
       {
           func = (new Function('return '+func))();
       }
       if(typeof func !== 'function')
       {
           return;
       }
       
       var strForm = func.toString().trim();
       
       var sig_and_body = strForm.split(funargs_regex);
       this.name = sig_and_body[0].trim().split('function')[0].trim();
       this.arguments = strForm.match(regex_set.funargs_regex)[1].substring(1,arguments.length-1).split(',');
       this.body = scanBody(sig_and_body[0], sig_and_body[1].trim());
   }
   
   function hashCode(input){
        var hash = 0, i, c;
        if (input.length == 0) return hash;
        for (i = 0; i < this.length; i++) {
            c = this.charCodeAt(i);
            hash = ((hash<<5) - hash) + c;
            hash = hash & hash; // Convert to 32bit integer
        }
        return 'async_' + hash.toString(16);
    }
   
      var tokens = [
          {name: 'forLoop', rule: forLoop_regex},
          {name: 'function', rule: function_regex},
          {name: 'plainline', rule: plainline_regex}
       ];
   
    function tokenize(input)
    {
         var t = tokens;
         var size = t.length;
         for(var i=0; i<size; i++){
            if(t[i].rule.test(input))
               return (t[i].name);
         }
         return null;
     }
   
   function processToken(token)
  {

        var t = tokens;
         var size = t.length;
         for(var i=0; i<size; i++){
            if(t[i].rule.test(input))
               return (t[i].name);
         }
         return null;
  }
   
   function scanBody(func_name, func_body)
  {
      var input = func_body.match(regex_set.blockContent_regex)[0].substring(1,input.length-1); //Match not necessary?
     var dissected_statements = [];
     var tokenStream = '';
     var content;
     var tokenInterpreted;
     var size = input.length;
     for(var inputPointer = 0; inputPointer < size; inputPointer++)
     {
        tokenStream += input.charAt(inputPointer);
        switch(processToken(tokenStream))
        {
            case 'forLoop':
                var sig = tokenStream.trim(), braced = false;
                if(tokenStream.charAt(tokenStream.length) == '{')
                {
                    braced = true;
                    sig = sig.substring(0, sig.length-1);
                    content = input.substring(tokenStream.length-1).match(regex_set.blockContent_regex)[0];
                }
                else
                {
                    //Establish extent of scope first
                    if(tokenStream.charAt(tokenStream.length) == ';') //statement on line
                    {
                        sig = tokenStream.match(regex_set.forLoop_sig_regex)[0];
                        content = '{' tokenStream.split(regex_set.forLoop_sig_regex)[0] + '}';
                    }
                    else
                    {
                        //Need to find the next statement.
                    }
                    //Add braces for the sake of code reusability
                    content = '{' + input.substring(inputPointer).match(regex_set.plainline_regex)[0].trim() + '}';
                }
                var forLoop = new forLoop(content, sig, braced);
                dissected_statements.push(forLoop);
            break;
            case 'function':
                var sig = tokenStream.trim();
                content = input.substring(inputPointer).match(regex_set.blockContent_regex)[0];
                var func = new FunctionDissected(sig + content);
                dissected_statements.push(func);
            break;
            case 'plainline':
                dissected_statements.push(tokenStream);
            break;    
        }
        
     }
     //Finish the remaining token. Should be plainline.
     process(inputPointer,input,token,activeScope);
     return activeScope;
  }
   
   var regex_set = {
       loop_block_determinant : '[((\s\n)*{)((\s\n)[*\w;])]',//End of scope for forLoop requires care if no braces,
       forLoop_sig : '\s*for\s*\(\S+)\s*',
      forLoop_regex : new RegExp(regex_set.forLoop_sig + regex_set.loop_block_determinant),
      forLoop_sig_regex : new RegExp(regex_set.forLoop_sig),
      //Regexes for functions rely on the JS parser to have validated well-formed names, relying on \S.
      funargs : '\s*\(\S+)\s*',
      funargs_regex: new RegExp(regex_set.funargs_regex),
      function_regex : new RegExp('\s*function'+regex_set.funargs),
      blockContent_regex : /{.*}/,
      plainline_regex : /^\s*(.*;|.+\n){1}$/
   };
 
 function CPS_ify(diss_func)
 {
     if(!diss_func instanceof FuncDissected)
     {
         return;
     }
     
     
 }
     

  function handleScript(scriptText)
  {
     var funcList = parseFunctionsFromText(scriptText);
      funcList = funcList.map(function(e,i){
          return CPS_ify(e);
      });
      
      return funcList.join(' ');
  }
  
  function handleFunction(func)
  {
      
  }
           
   function init(params){
       
       var async_set = [];
       var onlyOne = false;
       
       if(params === undefined) //No param, assume user is novice: transform all script tags with language="javascript/jsa" and return.
       {
          var scripts = Array.prototype.slice(document.getElementsByTagName('script'));
          var size = scripts.length;
          for(var i=0; i<size; i++){
             if(scripts[i].getAttribute('language') == 'javascript/jsa')
             {
                scripts[i].innerText = handleScript(scripts[i].innerText);
            }
          }
          
          return;
       }
       else if(params instanceof NodeList) //DOM Selection took place; make sure we have full Array methods.
       {
           async_set = Array.prototype.slice(params);
           var size = async_set.length;
           for(var i=0; i<size; i++){
             if(async_set[i].tagName.toLowerCase != 'script' )
             {
                 async_set.splice(i,1);
             }
           }
       }
       else if(params instanceof Array)
       {
           var size = async_set.length;
           for(var i=0; i<size; i++){
             if(async_set[i].tagName.toLowerCase != 'script' )
             {
                 async_set.splice(i,1);
             }
           }
       }
       else if(params instanceof Node)
       {
           if(params.tagName == 'script')
            async_set = [params];
           onlyOne = true;
       }
       else if(params instanceof Function)
       {
           async_set = [params];
           onlyOne = true;
       }
       
       var size = async_set.length;
       for(var i=0; i<size; i++){
           //Property testing for backward compatibility. At this point, the only tag we have is script, so it's a safe assumption
         if(async_set[i].tagName == 'script' )
         {
             async_set[i] = handleScript(async_set[i]);
         }
         else if(async_set[i] instanceof Function)
         {
             async_set[i] = handleFunction(async_set[i]);
         }
       }
       
        return onlyOne ? async_set[0] : async_set;
   }
               
   function page(){
      // document.getElementById('user').addEventListener('click',function(){
         // var val = parseInt(document.getElementById('number').value);
         // document.getElementById('number').value = ++val;
      // });
      asynchronize();
   }
               