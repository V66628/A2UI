1.维护原始协议
2.surface管理3.组件节点-hydrateNodeMap
4.Error信息

interface A2UIStore{
surfaceMap：<record,surface>,
hydrateNodeMap:<record,hydrateNode>,
}

interface Surface{
id:String,
beginRender:bool,
rootNode:HyrateNode
}

interface HydrateNode {
componentId:string,
\_vnode:ReactElement,
ownerSurfaceId:string,
protacal:string(JSONL协议)
}

enum ErrorType={
PARE_ERROR
}
interface Error{
type:ErrorType,
content:string
}

更新，删除，查找，添加（by id维度）

store里面还有对surfaceMap，HydrateNodeMap，ErrorMap的更新，删除，查找，添加操作。

store 通过zustand/vanilla实现状态管理。
为了解除对react的依赖

store是一个全局单例，需要导出一个方法可以拿到store实例
