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
 -->
