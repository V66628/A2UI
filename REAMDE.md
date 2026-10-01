## 项目介绍

实现一个A2UI-playground，用户通过web应用生成对应的ui界面

## 项目架构

项目使用monorepo组织代码
包含以下几个核心模块
packages-a2ui sdk npm包

- a2ui-react包含react组件库，用于在react项目中使用A2UI组件
- a2ui-core 包含UI组件库和渲染引擎，包含以下模块
  paser用来解析a2ui协议
  \_vnode 用来映射管理a2ui协议生成的组件
  treebuilder 用来构建a2ui协议生成的组件树

web

- a2ui-playground 包含web应用代码，用于生成ui界面
  主要职责以及详细功能
  可以通过对话的方式，让AI agent生成对应的UI界面
  可以预览对应的AI界面
  可以支持多轮对话生成UI进行调整
  可以预览a2ui-react定义的基础a2ui组件
  可以支持协议调试

server

- a2ui-server 包含服务器端代码，用于处理用户请求和生成ui界面
  基于openai 实现a2UI agent
  实现a2ui-server 支持a2UI协议的生成以及缓存

## 项目依赖

所有项目支持ts
web：使用vite构建playground
server:使用koa实现服务接口
agent基于openai建联
使用ts-node运行

<!--
与ai协作的步骤如下：
1.根据read.me文档，现在要启动A2UI的项目，需要按照基础方案设计，初始化对应的仓库及目录结构，安装相应的依赖，注意只初始化，不要实现具体的模块内容。
2.先启动 playground 验证环境
3.我看了下这个项目骨架是npm workspaces  我要用pnpm workspaces  重新帮我搭建这个项目骨架
3.根据store.MD文档，里面是关于a2ui的store部分的描述，现在在a2ui/store文件里面实现store
4.使用mocha配置一个单测试运行环境，实现一个initStore方法，通过单测保证store初始化成功。
5.a2ui-core暴露一个init方法，init时候调用createStore创建，在a2ui-playground中把创建后的store展示在页面中.
6.playground需要依赖a2ui-core以及a2ui-react源代码即可.
7.在a2ui-core里面，新增一个mock文件夹，用来存放mock的a2ui协议数据
按照a2ui源码的v0.8版本协议定义，生成一个最简单的包含一个text组件的a2ui协议mock数据
8.需要实现基础的parser，parser可以响应 text-v0.8.jsonl ，解析为对应的surface和hydrateNode ，先不要写代码，实现功能的测试用例。
parser的测试需要单独运行
9.协议是A2UI，A2UI是JSONL，仔细阅读 json文件夹的 a2ui协议的定义，分开处理server-client消息
10.在playground里面引入mock数据，并初始化，通过parser解析，需要看下store中的内容是否符合预期
11.现在需要在A2ui-react里面实现一个renderMap，里面定义Text组件渲染的tsx
把renderMap传入到init方法
在paser解析出需要更新component时，调用对应的render渲染出组件实例，并放在_vnocde里
在playground init时，引入renderMap
12.playground只展示store，放一个按钮，点击后通过dialog弹出store内容，使用antd作为UI库
13.需要实现treebuild，将hydrateNode组装为组件树结构（现在mock数据只有一个组件先忽略，不需要实现实际的树组装）
treebuild调用时机为每次parser A2UI JSONL协议后，返回组件树，在a2ui-playground里面增加 对应的渲染预览区域，通过react.render渲染
14.在调用renderer的时候需要检查对应的协议定义的组件是否注册，如果没有，需要在store中增加error，以及相关的错误描述信息。
15.在playground里面增加一个错误信息的按钮，点击后打开dialog展示store里面所有的error

16.现在需要在treebuild里面实现component tree的组装 首先需要一个child和parent结构。parent使用column组件，先在原子组件的renderMapspecification/json/standard_catalog_definition.json里面参考 ，实现一个column容器组件，然后增加一个column和三个Text组件的mock数据
17.创建对应的treebuild的单元测试，使用column的mock数据，生成对应的测试用例，来测试treebuild对于树形结构的处理。
18.再增加一个mock数据，需要更复杂一些的多级树型嵌套
19.为每一个mock或者测试数据创建一个按钮，可以点击按钮切换不同的mock数据在playground里面看对应的效果
20.现在按照协议组件内容以及参考column实现row的渲染，同时修改多级嵌套数据，让row跟cloumn混排。
21.viewStore做一下优化，顶部展示当前渲染的组件总数
22.现在需要实现buffer，stream处理jsonL的能力，首先把 column-nested-v0.8.jsonl 拆为一个A2UI消息里面只定义一个组件的JSONLine数组
23.在playground里面模拟stream，同步的逐条推送 column-nested-stream-v0.8.jsonl 里面定义的JSONL协议，由parser处理，看下是否符合预期
24.1.不要使用JSONL，直接使用TS模块定义JSONL数组
2。不需要额外的streamParser，而是parser天然就需要支持不断的调用以及更新组件的能力
25.要在init的时候，传入对应的渲染组件树的方法，由SDK内部来决定调用组件渲染的时机，现在的调用时机是每次treebuild后就调用
26.基于标记清除实现stream组件渲染时的淡出效果，在paser识别到新组件的时候，在hydrateNode中增加hasMounted标记。在renderMap渲染时，增加一个0.3s的淡出动画。动画结束时，通过暴露的方法把store中的hydratehasMounted设置为true
27.现在实现缓冲区， 增加一个模拟完整JSON stream输出的能力，每50ms输出50的长度。
buffer拿到不完整的JSON，需要尝试获取到完整的JSONL后，补全协议，发送给parser解析
每一个a2ui消息，需要处理为一个完整的可解析的jsonL，
suerfaceUpdate需要每一个component都处理成独立的jsonL
28.
 -->
