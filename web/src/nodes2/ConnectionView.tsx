/**
 * 自绘连线视图（Presets.classic.setup({ customize: { connection } }) 的目标组件）。
 *
 * 存在的唯一理由：把连接上的 waypoint（路径中点装饰件）画出来——rete 自带的
 * Connection 只认 useConnection() 给的 path（两点贝塞尔），塞不进第三个点。
 * 这里改用 waypointConnectionPath 自己算 d，并在中点补一个 <circle>。
 *
 * DOM 形状是**契约**，改动会静默打断十几处既有调用：
 * - 根节点必须保留 data-testid="connection"：nodeview.css 全部按它选择，
 *   graph-interact 的 closest('[data-testid="connection"]') 也靠它认线。
 * - 连线本体必须是**第一个 <path> 后代**：graph-interact / graph-model / graph 多处
 *   `view.element.querySelector("path")` 拿它加类（cyl-wire-x / drop-target / reconnect-x 等）
 *   并调 getTotalLength/getPointAtLength 做命中测试。所以圆点用 <circle> 且排在 path
 *   之后，绝不能是第二个 <path>。
 * - svg/path 的基础样式（9999px 画布、fill:none、stroke-width、path 上的
 *   pointer-events:auto）原本由 rete 的 styled.svg/styled.path 提供，接管后由
 *   nodeview.css 末尾那节补齐——少一条，连线的 hover 与命中测试就废。
 */
import { Presets } from "rete-react-plugin";
import { getConnectionWaypoint } from "./graph-model";
import type { Schemes } from "./graph-model";
import { waypointConnectionPath } from "./waypoint-path";

// useConnection 只挂在 classic 预设命名空间下（rete-react-plugin 根未导出），
// 取法与 NodeView.tsx 的 `const { RefSocket } = Presets.classic` 一致。
const { useConnection } = Presets.classic;

export function ConnectionView(props: { data: Schemes["Connection"] }) {
  const { start, end } = useConnection();
  // 端点尚未测量出来时不渲染——与 rete 自带 Connection「无 path 即 return null」同义。
  if (!start || !end) return null;
  const waypoint = getConnectionWaypoint(props.data);
  const d = waypointConnectionPath(start, end, waypoint);
  return (
    <svg data-testid="connection">
      <path d={d} />
      {/* 纯装饰：pointer-events 由 CSS 关掉——连线拾取走 hitTestConnection 的几何算法，
          让圆点可命中会破坏既有的抓线/重连行为。颜色也全交给 CSS 兄弟选择器，
          绝不在这里重复 applyConnectionTypeVisual 的类型查表（那是线色的唯一真源）。 */}
      {waypoint ? (
        <circle className="cyl-wp-dot" cx={waypoint.x} cy={waypoint.y} r={5} />
      ) : null}
    </svg>
  );
}
