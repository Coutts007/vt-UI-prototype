export type SiteCode =
  | 'stature'
  | 'shoulder'
  | 'chest'
  | 'waist'
  | 'hip'
  | 'sleeve'
  | 'outleg'
  | 'inleg'
  | 'neck';

export type Flag = 'pass' | 'check' | 'fail';

export type FlagReason =
  | 'scale_disagree'
  | 'level_unchecked'
  | 'loose_clothing'
  | 'landmark_low'
  | 'mask_gap'
  | 'out_of_range'
  | 'crotch_not_found'
  | 'marker_weak'
  | 'waist_level_mismatch'
  | 'view_failed';

export type CheckState = 'pass' | 'fail' | 'skipped';

export interface Landmark {
  x: number; // normalised 0..1 image coords
  y: number;
  z: number;
  visibility: number;
}

export interface MarkerObs {
  corners: [number, number][];
  image_w: number;
  image_h: number;
  side_px: number;
  confidence: number;
}

export interface ViewChecks {
  level: CheckState;
  frame: CheckState;
  distance: CheckState;
  symmetry: CheckState;
  arms: CheckState;
  marker: CheckState;
  light: CheckState;
  sharpness: CheckState;
}

export interface CaptureSession {
  session_id: string;
  started_at: string;
  capture_mode: 'self' | 'assisted';
  device_model: string;
  os: string;
  browser: string;
  memory_gb: number | null;
  model_variant: 'lite' | 'full' | 'heavy';
  stream_w: number;
  stream_h: number;
  still_source: 'imagecapture' | 'canvas' | 'file';
  level_unchecked: boolean;
  capture_fallback: boolean;
  front_checks: ViewChecks;
  side_checks: ViewChecks;
  scale_front_mm_px: number;
  scale_side_mm_px: number;
  scale_stature_mm_px: number;
  scale_disagreement_pct: number;
  processing_ms: number;
  retake_count: number;
  config_hash: string;
  study?: {
    participant_code: string;
    set_no: 1 | 2 | 3;
    lighting: 'window' | 'lamp' | 'outdoor';
    distance_m: number;
    clothing_fit_observed: 'fitted' | 'loose';
    lux?: number;
  };
}

export interface Measurement {
  site_code: SiteCode;
  value_mm: number | null; // C4: null when flag = 'fail'
  method: 'auto' | 'override';
  confidence_flag: Flag;
  flag_reasons: FlagReason[];
  correction_factor?: number;
  level_fraction?: number;
  half_width_mm?: number;
  half_depth_mm?: number;
}

export interface ConsentRecord {
  consent_version: string;
  language: 'en' | 'sw';
  scope: ('measure' | 'measurements_only' | 'retention' | 'study_paper')[];
  given_at: string;
  withdrawn_at?: string;
}

export interface MeasurementProfilePayload {
  profile_id: string;
  client_code: string;
  version: number;
  captured_at: string;
  status: 'final';
  rules_version: string;
  covariates: {
    height_mm_entered: number;
    sex: 'female' | 'male' | 'unspecified';
    clothing_fit: 'fitted' | 'loose';
    code_verified: boolean;
  };
  consent: ConsentRecord;
  session: CaptureSession;
  landmarks_front: Landmark[];
  landmarks_side: Landmark[];
  marker_front: MarkerObs;
  marker_side: MarkerObs;
  measurements: Measurement[];
}

export interface MeasurementProfile extends MeasurementProfilePayload {
  client_id?: string;
  sync_status: 'pending' | 'synced' | 'conflict' | 'rejected';
  created_at?: string;
}

export type GarmentType = 'shirt' | 'dress' | 'trousers' | 'suit_jacket' | 'skirt' | 'other';
export type OrderStatus = 'new' | 'cutting' | 'fitting' | 'ready' | 'collected';

export interface OrderItemInput {
  site_code: SiteCode;
  body_mm: number | null;
  ease_mm: number;
  overridden: boolean;
  override_reason?: string;
  flag_confirmed?: boolean;
  pending_fitting?: boolean;
}

export interface Order {
  order_id: string;
  order_no: string;
  client_id: string;
  client_code: string;
  display_name?: string;
  profile_id: string;
  profile_version: number;
  garment_type: GarmentType;
  status: OrderStatus;
  due_date: string;
  notes: string;
  items: (OrderItemInput & { finished_mm: number | null; confidence_flag: Flag })[];
  created_at: string;
  updated_at: string;
  status_history: { status: OrderStatus; at: string }[];
}

export interface AuditEntry {
  log_id: string;
  occurred_at: string;
  user_email: string;
  role: string;
  action:
    | 'login'
    | 'profile_view'
    | 'export'
    | 'share'
    | 'override'
    | 'deletion'
    | 'status_change'
    | 'code_issue'
    | 'approve'
    | 'settings_change';
  entity_type: string;
  entity_id: string;
  summary: string;
}

export type UserRole = 'tailor' | 'admin' | 'measurer';
export type AccountStatus = 'active' | 'pending' | 'disabled';

export interface UserAccount {
  user_id: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  business_name?: string;
  phone?: string;
  area?: string;
  locale: 'en' | 'sw';
  unit_pref: 'cm' | 'in';
  measurer_code?: string;
  created_at: string;
}

export interface ClientRecord {
  client_id: string;
  client_code: string;
  tailor_id: string;
  display_name?: string;
  height_mm?: number;
  created_at: string;
  profiles_count: number;
  latest_profile_at?: string;
  open_orders_count: number;
  has_flags: boolean;
  sync_conflict?: boolean;
}

export interface StudyParticipant {
  participant_id: string;
  participant_code: string; // P###
  sex: 'female' | 'male' | 'unspecified';
  age_band: '18-24' | '25-34' | '35-44' | '45-54' | '55+';
  venue: string;
  client_code: string;
  enrolled_at: string;
  sets_captured: number;
  readings_count: number;
}

export interface ReferenceReading {
  reading_id: string;
  participant_code: string;
  measurer_code: string;
  reading_no: 1 | 2;
  values_mm: Record<SiteCode, number>;
  taken_at: string;
  locked: boolean;
}
