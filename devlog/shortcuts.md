# Cyl1nder 快捷键 / Shortcuts

> 分类记录所有快捷键（键盘 + 鼠标）。新增快捷键必须在此登记。

## 全局（Global）
| 键 | 动作 |
|---|---|
| `F` | **Frame（按悬停区域）**：悬停在节点图 → frame 选中节点（无选中则全部）；悬停在 3D 视口 → frame 几何体（无几何体则复位默认视角） |
| `Tab` | 节点图 Tab 搜索面板开关 |

## 节点图（Node graph，rete.js 2）
| 键/鼠标 | 动作 |
|---|---|
| `Tab` | 打开节点搜索（Fuse.js 模糊搜索 `_input_` / `_output_` / `null`），↑↓ 选择 / Enter 创建 / Esc 关闭 |
| `Y`（按住）+ 拖动 | **红线剪切**：按住 Y 拖动画一条红线，划过的所有连线被切断；原地点击（不拖）切掉光标下的单条边 |
| 拖动 null 节点到连线 | **插入网络**：拖动时金色高亮预览边，松开插入（A→null→B） |
| 右键节点 | Flags 菜单（Display / Bypass / Freeze / Wireframe / Delete） |
| 节点右上 `D` chip | Houdini Display：点亮该节点（一个 net 仅一个），默认选中其第一个端口数据 |
| 中键（MMB）拖动 | 画布平移 |
| 滚轮 | 缩放 |
| 悬停端口 | 自定义深色 tooltip（`input/output · <port> (geo)`）+ 加粗高亮 |
| 悬停节点/连线 | 加粗高亮（连线为辉光效果） |

## 3D 视口（Viewport，three.js）
| 键/鼠标 | 动作 |
|---|---|
| `Alt` + 左键拖动 | 旋转 |
| `Alt` + 中键拖动 | 平移 |
| `Alt` + 右键拖动 | 缩放（OrbitControls dolly） |
| 右键拖动（Alt 或无 Alt） | **归一化拖拽缩放**：向右上拖 = 放大拉近，向左下拖 = 拉远，增量归一化，灵敏度约 2 倍 |
| 滚轮 / 右键拖拽 | **真位移 dolly**：只改相机位置（焦距固定），0.05~500 距离钳制，永不 NaN / 不穿越目标 |
| 右上角模式 chip（点击/拖动） | 显示模式菜单：Smooth Shaded / Smooth Wire Shaded / Flat Shaded / Flat Wire Shaded / Unlit Shaded / Unlit Wire Shaded / Wireframe / Wireframe Ghost（单击=持久显示，拖动=松手应用悬停项） |
| `W` | **Ghost 切换**：Smooth/Flat/Unlit/Wireframe → Wireframe Ghost ↔ 恢复原模式（记忆切换） |
| `Shift+W` | **着色对切换**：Smooth Shaded ↔ Smooth Wire Shaded / Flat Shaded ↔ Flat Wire Shaded / Unlit Shaded ↔ Unlit Wire Shaded |
| 左键点选曲线 | 选中并拖拽平移（TransformControls，编辑 → push outputs） |