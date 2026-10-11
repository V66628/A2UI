import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BellOutlined,
  CalendarOutlined,
  CameraOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  CreditCardOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  EnvironmentOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FolderOutlined,
  HeartFilled,
  HeartOutlined,
  HomeOutlined,
  IdcardOutlined,
  InfoCircleOutlined,
  LockOutlined,
  MailOutlined,
  MenuOutlined,
  MoreOutlined,
  NotificationOutlined,
  PaperClipOutlined,
  PhoneOutlined,
  PictureOutlined,
  PlusOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  ScheduleOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  ShareAltOutlined,
  ShoppingCartOutlined,
  StarFilled,
  StarOutlined,
  UnlockOutlined,
  UploadOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ComponentType, CSSProperties } from "react";
import type { ComponentStyles } from "@a2ui/core";
import { stylesToCss } from "@a2ui/core";

/**
 * A2UI 标准 Icon canonical 名（standard catalog enum）→ antd 图标组件。
 * canonical 名是渲染器中立的协议词汇；本文件是 React/antd renderer 的落地映射。
 *
 * 注意：部分 canonical 名在 antd 中没有完全等价物（starHalf、
 * notificationsOff 等），映射到视觉最接近的组件。
 */
export const CANONICAL_ICON_MAP: Record<string, ComponentType> = {
  accountCircle: IdcardOutlined,
  add: PlusOutlined,
  arrowBack: ArrowLeftOutlined,
  arrowForward: ArrowRightOutlined,
  attachFile: PaperClipOutlined,
  calendarToday: CalendarOutlined,
  call: CustomerServiceOutlined,
  camera: CameraOutlined,
  check: CheckOutlined,
  close: CloseOutlined,
  delete: DeleteOutlined,
  download: DownloadOutlined,
  edit: EditOutlined,
  event: ScheduleOutlined,
  error: CloseCircleOutlined,
  favorite: HeartFilled,
  favoriteOff: HeartOutlined,
  folder: FolderOutlined,
  help: QuestionCircleOutlined,
  home: HomeOutlined,
  info: InfoCircleOutlined,
  locationOn: EnvironmentOutlined,
  lock: LockOutlined,
  lockOpen: UnlockOutlined,
  mail: MailOutlined,
  menu: MenuOutlined,
  moreVert: MoreOutlined,
  moreHoriz: EllipsisOutlined,
  notifications: BellOutlined,
  notificationsOff: NotificationOutlined,
  payment: CreditCardOutlined,
  person: UserOutlined,
  phone: PhoneOutlined,
  photo: PictureOutlined,
  print: PrinterOutlined,
  refresh: ReloadOutlined,
  search: SearchOutlined,
  send: SendOutlined,
  settings: SettingOutlined,
  share: ShareAltOutlined,
  shoppingCart: ShoppingCartOutlined,
  star: StarFilled,
  starHalf: StarOutlined,
  starOff: StarOutlined,
  upload: UploadOutlined,
  visibility: EyeOutlined,
  visibilityOff: EyeInvisibleOutlined,
  warning: WarningOutlined,
};

export interface A2UIIconProps {
  /** 标准 canonical 图标名（如 "home"）；未知名不渲染 */
  name: string;
  /** 组件级样式覆盖 */
  styles?: ComponentStyles;
}

/** 无样式的原子图标：按 canonical 名取 antd 组件渲染 */
export function A2UIIcon({ name, styles }: A2UIIconProps) {
  const IconComponent = CANONICAL_ICON_MAP[name] as
    | ComponentType<{ style?: CSSProperties }>
    | undefined;
  if (!IconComponent) return null;
  return (
    <IconComponent
      style={styles ? (stylesToCss(styles) as CSSProperties) : undefined}
    />
  );
}
