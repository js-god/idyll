import { getCiphers } from 'tls';

const values = require('object.values');
const entries = require('object.entries');
const falafel = require('falafel');
const { getChildren, getNodeName, getProperties, getType, setChildren } = require('idyll-astV2');
export const buildExpression = (acc, expr, key, context, isEventHandler) => {
  return `
    ((context) => {
        var __idyllStateProxy = new Proxy({}, {
          get: (_, prop) => {
            return context[prop];
          },
          set: (_, prop, value) => {
            var newState = {};
            newState[prop] = value;
            context.update(newState);
            return true;
          }
        })
        ${falafel(isEventHandler ? expr : `var __idyllReturnValue = ${expr || 'undefined'}`, (node) => {
          switch(node.type) {
            case 'Identifier':
              if (Object.keys(acc).indexOf(node.name) > -1) {
                node.update('__idyllStateProxy.' + node.source());
              }
              break;
          }
        })};
        ${isEventHandler ? '' : 'return __idyllReturnValue;'}
    })(this)
  `;
}


export const evalExpression = (acc, expr, key, context) => {
  const isEventHandler = (key && (key.match(/^on[A-Z].*/) || key.match(/^handle[A-Z].*/)));
  let e = buildExpression(acc, expr, key, context, isEventHandler);

  if (isEventHandler) {
    return (function() {
      eval(e);
    }).bind(Object.assign({}, acc, context || {}));
  }

  try {
    return (function(evalString){
      try {
        return eval('(' + evalString + ')');
      } catch(err) {}
    }).call(Object.assign({}, acc, context || {}), e);
  } catch (err) {}
}

/*
arr -> list of vars 
return -> Object(key-> name value -> value of the var)*/
export const getVars = (arr, context = {}, evalContext) => {
  const pluck = (acc, val) => {
    const variableType = getType(node); 
    const attrs = getProperties(val)|| []; 

    if(!attrs.name || !attrs.value) return attrs; 

    const nameValue = attrs.name.value; 
    const valueType = attrs.value.type; 
    const valueValue = attrs.value.value; 

    switch(valueType) {
      case 'value':
        acc[nameValue] = valueValue;
        break;
      case 'variable':
        if (context.hasOwnProperty(valueValue)) {
          acc[nameValue] = context[valueValue];
        } else {
          acc[nameValue] = evalExpression(context, expr);
        }
        break;
      case 'expression':
        const expr = valueValue;
        if (variableType === 'var') {
          acc[nameValue] = evalExpression(context, expr);
        } else {
          acc[nameValue] = {
            value: evalExpression(context, expr),
            update: (newState, oldState) => {
              return evalExpression(Object.assign({}, oldState, newState), expr)
            }
          }
        }
    }
    return acc;
  }

  return arr.reduce(
    pluck,
    {}
  )
}

export const filterIdyllProps = (props, filterInjected) => {
  const {
    __vars__,
    __expr__,
    hasHook,
    isHTMLNode,
    refName,
    onEnterViewFully,
    onEnterView,
    onExitViewFully,
    onExitView,
    ...rest
  } = props;
  if (filterInjected) {
    const { idyll, hasError, updateProps, ...ret} = rest;
    return ret;
  }
  return rest;
}
export const getData = (arr, datasets = {}) => {
  const pluck = (acc, val) => {    
    const nameValue = getProperties(val).name.value;
    acc[nameValue] = datasets[nameValue];

    return acc;
  }

  return arr.reduce(
    pluck,
    {}
  )
}

export const splitAST = (ast) => {
  const state = {
    vars: [],
    derived: [],
    data: [],
    elements: [],
  }

  const handleNode = (storeElements) => {
    return (node) => {
      const type = getType(node); 
      const props = getProperties(node);
      const children = getChildren(node); 

      if (type === 'var') {
        state.vars.push(node);
      } else if (state[type]) {
        state[type].push(node);
      } else if (storeElements) {
        state.elements.push(node);
      }
      //typeof children === 'string'; 
      if (!children || (children.length === 1 && getType(children[0]) === "textnode")) {
        return;
      }
      children.forEach(handleNode(false));
    }
  }

  ast.forEach(handleNode(true));
  return state;
}

export const hooks = [
  'onEnterView',
  'onEnterViewFully',
  'onExitView',
  'onExitViewFully'
];

export const scrollMonitorEvents = {
  'onEnterView': 'enterViewport',
  'onEnterViewFully': 'fullyEnterViewport',
  'onExitView': 'partiallyExitViewport',
  'onExitViewFully': 'exitViewport'
}

export const translate = (arr) => {
  const attrConvert = (list) => {
    return Object.keys(list).reduce(
      (acc, key) => {
        const name = key; 
        const type = list[key].type; 
        const val = list[key].value;
        if (type === 'variable') {
          acc.__vars__ = acc.__vars__ || {};
          acc.__vars__[name] = val;
        }
        // each node keeps a list of props that are expressions
        if (type === 'expression') {
          acc.__expr__ = acc.__expr__ || {};
          acc.__expr__[name] = val;
        }
        // flag nodes that define a hook function
        if (hooks.includes(name)) {
          acc.hasHook = true;
        };

        acc[name] = val;
        return acc;
      },
      {}
    )
  }

  const tNode = (node) => {
    if (getType(node) === 'textnode') return node;

    //if (node.length === 3) {
      //const [ name, attrs, children ] = node;
      if(["var", "derived", "data"].indexOf(getType(node)) > -1 ) {
        const name = getType(node); 
      } else {
        const name = getNodeName(name); 
      }
      const attrs = getProperties(node); 
      const children = getChildren(node); 
      return {
        component: name,
        ...attrConvert(attrs),
        children: children.map(tNode),
      }
    //}
  }

  return splitAST(arr).elements.map(tNode)
}

export const mapTree = (tree, mapFn, filterFn = () => true) => {
  const walkFn = (acc, node) => {
    if (getType(node) === "textnode") {
      if (hasChildren(node)) {
        // translated schema
        setChildren(node, getChildren(node.children).reduce(walkFn, []) );
      } else {
        // compiler AST
        setChildren(node, getChildren(node).reduce(walkFn, []));
      }
    }

    if (filterFn(node)) acc.push(mapFn(node));
    return acc;
  };

  return tree.reduce(
    walkFn,
    []
  );
};

export const filterASTForDocument = (ast) => {
  return mapTree(ast, n => n, ([name]) => name !== 'meta')
};

export const findWrapTargets = (schema, state) => {
  const targets = [];
  const stateKeys = Object.keys(state);

  // always return node so we can walk the whole tree
  // but collect and ultimately return just the nodes
  // we are interested in wrapping
  mapTree(schema, (node) => {
    if (getType(node) === "textnode") return node;

    if (node.hasHook) {
      targets.push(node);
      return node;
    }

    // wrap all custom components
    const startsWith = node.component.charAt(0);
    if (startsWith === startsWith.toUpperCase()) {
      targets.push(node);
      return node;
    }

    // pull off the props we don't need to check
    const { component, children, __vars__, __expr__, ...props } = node;
    const expressions = Object.keys(__expr__ || {});
    const variables = Object.keys(__vars__ || {});

    // iterate over the node's prop values
    entries(props).forEach(([key, val]) => {
      // avoid checking more props if we know it's a match
      if (targets.includes(node)) return;

      // Include nodes that reference a variable or expression.
      if (variables.includes(key) || expressions.includes(key)) {
        targets.push(node);
      }
    });

    return node;
  })

  return targets;
}
