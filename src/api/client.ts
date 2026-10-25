import {
  UserAccount,
  ClientRecord,
  MeasurementProfile,
  MeasurementProfilePayload,
  Order,
  OrderItemInput,
  OrderStatus,
  GarmentType,
  AuditEntry,
  StudyParticipant,
  ReferenceReading,
  SiteCode,
} from '../types/api';
import {
  SEED_USERS,
  SEED_CLIENTS,
  SEED_PROFILES,
  SEED_ORDERS,
  SEED_AUDIT,
  SEED_STUDY_PARTICIPANTS,
  SEED_REFERENCE_READINGS,
} from './mockData';

export interface PublicSettings {
  study_mode: boolean;
  consent_version: string;
  min_app_version: string;
}

export interface ClientCodeVerification {
  valid: boolean;
  tailor_business_name: string;
  height_mm?: number;
}

export interface SheetResult {
  sheet_id: string;
  order_id: string;
  png_url: string;
  pdf_url: string;
  share_text: string;
  generated_at: string;
}

class ApiClient {
  private users: UserAccount[] = [];
  private clients: ClientRecord[] = [];
  private profiles: MeasurementProfile[] = [];
  private orders: Order[] = [];
  private audit: AuditEntry[] = [];
  private participants: StudyParticipant[] = [];
  private readings: ReferenceReading[] = [];
  private currentUser: UserAccount | null = null;
  private studyMode = true; // default true for study screens demo

  constructor() {
    this.loadState();
  }

  private loadState(): void {
    try {
      const storedUsers = localStorage.getItem('vt_api_users');
      this.users = storedUsers ? JSON.parse(storedUsers) : [...SEED_USERS];

      const storedClients = localStorage.getItem('vt_api_clients');
      this.clients = storedClients ? JSON.parse(storedClients) : [...SEED_CLIENTS];

      const storedProfiles = localStorage.getItem('vt_api_profiles');
      this.profiles = storedProfiles ? JSON.parse(storedProfiles) : [...SEED_PROFILES];

      const storedOrders = localStorage.getItem('vt_api_orders');
      this.orders = storedOrders ? JSON.parse(storedOrders) : [...SEED_ORDERS];

      const storedAudit = localStorage.getItem('vt_api_audit');
      this.audit = storedAudit ? JSON.parse(storedAudit) : [...SEED_AUDIT];

      const storedParts = localStorage.getItem('vt_api_participants');
      this.participants = storedParts ? JSON.parse(storedParts) : [...SEED_STUDY_PARTICIPANTS];

      const storedReadings = localStorage.getItem('vt_api_readings');
      this.readings = storedReadings ? JSON.parse(storedReadings) : [...SEED_REFERENCE_READINGS];

      // Session auth check
      const sessionUser = sessionStorage.getItem('vt_session_user');
      if (sessionUser) {
        this.currentUser = JSON.parse(sessionUser);
      }
    } catch {
      this.users = [...SEED_USERS];
      this.clients = [...SEED_CLIENTS];
      this.profiles = [...SEED_PROFILES];
      this.orders = [...SEED_ORDERS];
      this.audit = [...SEED_AUDIT];
      this.participants = [...SEED_STUDY_PARTICIPANTS];
      this.readings = [...SEED_REFERENCE_READINGS];
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem('vt_api_users', JSON.stringify(this.users));
      localStorage.setItem('vt_api_clients', JSON.stringify(this.clients));
      localStorage.setItem('vt_api_profiles', JSON.stringify(this.profiles));
      localStorage.setItem('vt_api_orders', JSON.stringify(this.orders));
      localStorage.setItem('vt_api_audit', JSON.stringify(this.audit));
      localStorage.setItem('vt_api_participants', JSON.stringify(this.participants));
      localStorage.setItem('vt_api_readings', JSON.stringify(this.readings));
    } catch {
      // ignore
    }
  }

  private logAudit(
    action: AuditEntry['action'],
    entity_type: string,
    entity_id: string,
    summary: string
  ): void {
    const entry: AuditEntry = {
      log_id: 'log-' + Math.random().toString(36).substring(2, 9),
      occurred_at: new Date().toISOString(),
      user_email: this.currentUser?.email || 'client-anonymous',
      role: this.currentUser?.role || 'client',
      action,
      entity_type,
      entity_id,
      summary,
    };
    this.audit.unshift(entry);
    this.saveState();
  }

  // --- Public Settings ---
  async getPublicSettings(): Promise<PublicSettings> {
    return {
      study_mode: this.studyMode,
      consent_version: '1.0',
      min_app_version: '1.0.0',
    };
  }

  async setStudyMode(enabled: boolean): Promise<void> {
    this.studyMode = enabled;
    this.logAudit('settings_change', 'settings', 'study_mode', `Study mode set to ${enabled}`);
  }

  // --- Public Businesses Directory ---
  async getPublicBusinesses(search = '', specialty = '', area = ''): Promise<UserAccount[]> {
    let list = this.users.filter((u) => u.role === 'tailor' && u.status === 'active');

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          (u.business_name && u.business_name.toLowerCase().includes(q)) ||
          (u.area && u.area.toLowerCase().includes(q)) ||
          (u.description && u.description.toLowerCase().includes(q)) ||
          (u.public_client_code && u.public_client_code.toLowerCase().includes(q))
      );
    }

    if (specialty && specialty !== 'all') {
      list = list.filter((u) => u.specialties && u.specialties.some((s) => s.toLowerCase().includes(specialty.toLowerCase())));
    }

    if (area && area !== 'all') {
      list = list.filter((u) => u.area && u.area.toLowerCase().includes(area.toLowerCase()));
    }

    return list;
  }

  async getBusinessById(userId: string): Promise<UserAccount | null> {
    return this.users.find((u) => u.user_id === userId && u.role === 'tailor') || null;
  }

  // --- Client Code Check ---
  async verifyClientCode(code: string): Promise<ClientCodeVerification> {
    const upperCode = code.trim().toUpperCase();

    // Check specific client record
    const client = this.clients.find((c) => c.client_code === upperCode);
    if (client) {
      const tailor = this.users.find((u) => u.user_id === client.tailor_id);
      return {
        valid: true,
        tailor_business_name: tailor?.business_name || 'Virtual Tailor Workshop',
        height_mm: client.height_mm,
      };
    }

    // Check public business code from directory
    const tailor = this.users.find((u) => u.public_client_code === upperCode && u.role === 'tailor');
    if (tailor) {
      // Ensure client record exists for this public code
      const existingClient = this.clients.find((c) => c.client_code === upperCode);
      if (!existingClient) {
        this.clients.push({
          client_id: 'c-' + Math.random().toString(36).substring(2, 9),
          client_code: upperCode,
          tailor_id: tailor.user_id,
          display_name: '',
          created_at: new Date().toISOString(),
          profiles_count: 0,
          open_orders_count: 0,
          has_flags: false,
        });
        this.saveState();
      }
      return {
        valid: true,
        tailor_business_name: tailor.business_name || 'Virtual Tailor Workshop',
      };
    }

    throw new Error('Code not found. Please verify with your tailor or browse the directory.');
  }

  async getClientCodeForBusiness(businessUserId: string, clientDisplayName?: string): Promise<{ client_code: string; tailor_business_name: string; area?: string }> {
    const tailor = this.users.find((u) => u.user_id === businessUserId && u.role === 'tailor');
    if (!tailor) throw new Error('Business not found');

    if (tailor.public_client_code) {
      // Ensure it is in clients
      if (!this.clients.some((c) => c.client_code === tailor.public_client_code)) {
        this.clients.push({
          client_id: 'c-' + Math.random().toString(36).substring(2, 9),
          client_code: tailor.public_client_code,
          tailor_id: tailor.user_id,
          display_name: clientDisplayName || '',
          created_at: new Date().toISOString(),
          profiles_count: 0,
          open_orders_count: 0,
          has_flags: false,
        });
        this.saveState();
      }
      return {
        client_code: tailor.public_client_code,
        tailor_business_name: tailor.business_name || 'Tailor Workshop',
        area: tailor.area,
      };
    }

    // Generate code
    const initials = (tailor.business_name || 'VT')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .padEnd(2, 'T')
      .slice(0, 2);
    const num = Math.floor(1000 + Math.random() * 9000);
    const newCode = `${initials}${num}`;
    tailor.public_client_code = newCode;

    this.clients.push({
      client_id: 'c-' + Math.random().toString(36).substring(2, 9),
      client_code: newCode,
      tailor_id: tailor.user_id,
      display_name: clientDisplayName || '',
      created_at: new Date().toISOString(),
      profiles_count: 0,
      open_orders_count: 0,
      has_flags: false,
    });
    this.saveState();

    return {
      client_code: newCode,
      tailor_business_name: tailor.business_name || 'Tailor Workshop',
      area: tailor.area,
    };
  }

  // --- Profile Submission ---
  async submitProfile(payload: MeasurementProfilePayload): Promise<{ profile_id: string; version: number }> {
    const client = this.clients.find((c) => c.client_code === payload.client_code);
    const existing = this.profiles.filter((p) => p.client_code === payload.client_code);

    // Conflict detection simulation
    const maxVersion = existing.reduce((max, p) => Math.max(max, p.version), 0);
    if (payload.version <= maxVersion && existing.length > 0) {
      // Version conflict (FR-11)
      throw new Error('Version conflict: a newer profile already exists on the server.');
    }

    const newProfile: MeasurementProfile = {
      ...payload,
      client_id: client?.client_id,
      sync_status: 'synced',
      created_at: new Date().toISOString(),
    };

    this.profiles.unshift(newProfile);
    if (client) {
      client.profiles_count += 1;
      client.latest_profile_at = newProfile.captured_at;
      client.has_flags = newProfile.measurements.some((m) => m.confidence_flag !== 'pass');
    }
    this.saveState();

    this.logAudit(
      'profile_view',
      'profile',
      newProfile.profile_id,
      `New profile synced for client ${payload.client_code}`
    );

    return { profile_id: newProfile.profile_id, version: newProfile.version };
  }

  // --- Auth ---
  async login(email: string, pass: string): Promise<UserAccount> {
    const user = this.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) {
      throw new Error('Invalid email or password.');
    }
    if (pass !== 'vt-demo-2026' && pass.length < 6) {
      throw new Error('Invalid email or password.');
    }
    if (user.status === 'pending') {
      throw new Error('Your account is waiting for administrator approval.');
    }
    if (user.status === 'disabled') {
      throw new Error('Your account has been deactivated. Contact administration.');
    }

    this.currentUser = user;
    sessionStorage.setItem('vt_session_user', JSON.stringify(user));
    this.logAudit('login', 'auth', user.user_id, `User ${user.email} signed in`);
    return user;
  }

  async registerTailor(data: {
    email: string;
    business_name: string;
    phone: string;
    area: string;
    address?: string;
    specialties?: string[];
    description?: string;
    turnaround_days?: string;
    pricing_tier?: 'Affordable' | 'Mid-Range' | 'Premium Bespoke';
    locale: 'en' | 'sw';
  }): Promise<UserAccount> {
    const existing = this.users.find((u) => u.email.toLowerCase() === data.email.trim().toLowerCase());
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    // Generate unique 6-char business client code
    const initials = data.business_name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .padEnd(2, 'T')
      .slice(0, 2);
    const num = Math.floor(1000 + Math.random() * 9000);
    const public_client_code = `${initials}${num}`;

    const newUser: UserAccount = {
      user_id: 'u-' + Math.random().toString(36).substring(2, 9),
      email: data.email,
      role: 'tailor',
      status: 'active', // Auto-activate so business is immediately browsable and clients can use the code
      business_name: data.business_name,
      phone: data.phone,
      area: data.area,
      address: data.address || '',
      locale: data.locale,
      unit_pref: 'cm',
      created_at: new Date().toISOString(),
      public_client_code,
      specialties: data.specialties && data.specialties.length > 0 ? data.specialties : ['Custom Tailoring', 'General Garments'],
      description: data.description || `${data.business_name} located in ${data.area}. Quality tailoring and garment making.`,
      rating: 5.0,
      reviews_count: 1,
      turnaround_days: data.turnaround_days || '5-7 days',
      pricing_tier: data.pricing_tier || 'Mid-Range',
      is_directory_listed: true,
    };

    this.users.push(newUser);

    // Register primary client code record for the new workshop
    this.clients.unshift({
      client_id: 'c-' + Math.random().toString(36).substring(2, 9),
      client_code: public_client_code,
      tailor_id: newUser.user_id,
      display_name: 'General Customer Intake',
      created_at: new Date().toISOString(),
      profiles_count: 0,
      open_orders_count: 0,
      has_flags: false,
    });

    this.saveState();
    this.logAudit('approve', 'user', newUser.user_id, `Business registered: ${newUser.business_name} (${public_client_code})`);
    return newUser;
  }

  async updateTailorPublicProfile(userId: string, updates: Partial<UserAccount>): Promise<UserAccount> {
    const user = this.users.find((u) => u.user_id === userId);
    if (!user) throw new Error('User not found');
    Object.assign(user, updates);
    this.saveState();
    if (this.currentUser?.user_id === userId) {
      this.currentUser = { ...user };
      sessionStorage.setItem('vt_session_user', JSON.stringify(this.currentUser));
    }
    return user;
  }

  getCurrentUser(): UserAccount | null {
    return this.currentUser;
  }

  logout(): void {
    this.currentUser = null;
    sessionStorage.removeItem('vt_session_user');
  }

  // --- Tailor Clients ---
  async getClients(search = '', filter = 'all'): Promise<ClientRecord[]> {
    let list = this.clients.filter((c) => {
      if (this.currentUser?.role === 'tailor') {
        return c.tailor_id === this.currentUser.user_id;
      }
      return true;
    });

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.client_code.toLowerCase().includes(q) ||
          (c.display_name && c.display_name.toLowerCase().includes(q))
      );
    }

    if (filter === 'flags') {
      list = list.filter((c) => c.has_flags);
    } else if (filter === 'conflicts') {
      list = list.filter((c) => c.sync_conflict);
    } else if (filter === 'no_measurements') {
      list = list.filter((c) => c.profiles_count === 0);
    }

    return list;
  }

  async issueClientCode(data: { display_name?: string; height_mm?: number }): Promise<ClientRecord> {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const randLetters = letters[Math.floor(Math.random() * 26)] + letters[Math.floor(Math.random() * 26)];
    const randDigits = Math.floor(1000 + Math.random() * 9000).toString();
    const client_code = `${randLetters}${randDigits}`;

    const newClient: ClientRecord = {
      client_id: 'c-' + Math.random().toString(36).substring(2, 9),
      client_code,
      tailor_id: this.currentUser?.user_id || 'u-wanjiru',
      display_name: data.display_name || '',
      height_mm: data.height_mm,
      created_at: new Date().toISOString(),
      profiles_count: 0,
      open_orders_count: 0,
      has_flags: false,
    };

    this.clients.unshift(newClient);
    this.saveState();
    this.logAudit('code_issue', 'client', newClient.client_id, `Issued code ${client_code}`);
    return newClient;
  }

  async getClientById(id: string): Promise<ClientRecord | null> {
    return this.clients.find((c) => c.client_id === id) || null;
  }

  async updateClient(id: string, updates: { display_name?: string; height_mm?: number }): Promise<ClientRecord> {
    const client = this.clients.find((c) => c.client_id === id);
    if (!client) throw new Error('Client not found');
    if (updates.display_name !== undefined) client.display_name = updates.display_name;
    if (updates.height_mm !== undefined) client.height_mm = updates.height_mm;
    this.saveState();
    return client;
  }

  async getProfilesForClient(clientCode: string): Promise<MeasurementProfile[]> {
    return this.profiles.filter((p) => p.client_code === clientCode);
  }

  async getProfileById(profileId: string): Promise<MeasurementProfile | null> {
    const p = this.profiles.find((item) => item.profile_id === profileId) || null;
    if (p) {
      this.logAudit('profile_view', 'profile', profileId, `Viewed profile ${profileId}`);
    }
    return p;
  }

  // --- Orders ---
  async getOrders(statusFilter?: OrderStatus): Promise<Order[]> {
    let list = [...this.orders];
    if (statusFilter) {
      list = list.filter((o) => o.status === statusFilter);
    }
    return list;
  }

  async getOrderById(id: string): Promise<Order | null> {
    return this.orders.find((o) => o.order_id === id) || null;
  }

  async createOrder(data: {
    client_id: string;
    profile_id: string;
    garment_type: GarmentType;
    due_date: string;
    notes: string;
    items: OrderItemInput[];
  }): Promise<Order> {
    const client = this.clients.find((c) => c.client_id === data.client_id);
    const profile = this.profiles.find((p) => p.profile_id === data.profile_id);
    if (!client || !profile) throw new Error('Client or Profile not found');

    const orderNum = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    const orderItems = data.items.map((item) => {
      const orig = profile.measurements.find((m) => m.site_code === item.site_code);
      const finished = item.body_mm !== null ? item.body_mm + item.ease_mm : null;
      return {
        ...item,
        finished_mm: finished,
        confidence_flag: orig?.confidence_flag || 'pass',
      };
    });

    const newOrder: Order = {
      order_id: 'ord-' + Math.random().toString(36).substring(2, 9),
      order_no: orderNum,
      client_id: client.client_id,
      client_code: client.client_code,
      display_name: client.display_name,
      profile_id: profile.profile_id,
      profile_version: profile.version,
      garment_type: data.garment_type,
      status: 'new',
      due_date: data.due_date,
      notes: data.notes,
      items: orderItems,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status_history: [{ status: 'new', at: new Date().toISOString() }],
    };

    this.orders.unshift(newOrder);
    client.open_orders_count += 1;
    this.saveState();
    this.logAudit('status_change', 'order', newOrder.order_id, `Created order ${orderNum}`);
    return newOrder;
  }

  async updateOrderStatus(orderId: string, newStatus: OrderStatus): Promise<Order> {
    const order = this.orders.find((o) => o.order_id === orderId);
    if (!order) throw new Error('Order not found');
    order.status = newStatus;
    order.updated_at = new Date().toISOString();
    order.status_history.push({ status: newStatus, at: order.updated_at });
    this.saveState();
    this.logAudit('status_change', 'order', orderId, `Updated status to ${newStatus}`);
    return order;
  }

  async updateOrderItemOverride(
    orderId: string,
    siteCode: SiteCode,
    newValueMm: number,
    reason: string
  ): Promise<Order> {
    const order = this.orders.find((o) => o.order_id === orderId);
    if (!order) throw new Error('Order not found');
    const item = order.items.find((i) => i.site_code === siteCode);
    if (!item) throw new Error('Item not found');
    item.body_mm = newValueMm;
    item.finished_mm = newValueMm + item.ease_mm;
    item.overridden = true;
    item.override_reason = reason;
    item.flag_confirmed = true;
    order.updated_at = new Date().toISOString();
    this.saveState();
    this.logAudit(
      'override',
      'order',
      orderId,
      `Overrode ${siteCode} to ${newValueMm}mm. Reason: ${reason}`
    );
    return order;
  }

  // --- Specification Sheet & Sharing ---
  async generateSpecSheet(orderId: string, includeName = false): Promise<SheetResult> {
    const order = this.orders.find((o) => o.order_id === orderId);
    if (!order) throw new Error('Order not found');

    const nameSegment = includeName && order.display_name ? ` · ${order.display_name}` : '';
    let share_text = `Virtual Tailor · Client ${order.client_code}${nameSegment} · Profile v${order.profile_version} · ${order.garment_type.toUpperCase()} · Due ${order.due_date}\n\n`;

    order.items.forEach((item) => {
      const cm = item.finished_mm ? (item.finished_mm / 10).toFixed(1) + ' cm' : 'Not measured';
      const flagSymbol = item.confidence_flag === 'pass' ? '✓' : item.confidence_flag === 'check' ? '▲ check' : '✕';
      share_text += `• ${item.site_code}: ${cm} ${flagSymbol}\n`;
    });
    share_text += `\nNo photo is stored. Kenya Data Protection Act 2019.`;

    this.logAudit('export', 'order_sheet', orderId, `Generated specification sheet for ${order.order_no}`);

    return {
      sheet_id: 'sheet-' + Math.random().toString(36).substring(2, 9),
      order_id: orderId,
      png_url: `/static/sheet-preview.png`,
      pdf_url: `/static/sheet-preview.pdf`,
      share_text,
      generated_at: new Date().toISOString(),
    };
  }

  async logShare(sheetId: string, via: 'whatsapp_share' | 'wa_link' | 'download' | 'print'): Promise<void> {
    this.logAudit('share', 'sheet', sheetId, `Shared specification sheet via ${via}`);
  }

  // --- Audit Log ---
  async getAuditEntries(): Promise<AuditEntry[]> {
    return [...this.audit];
  }

  // --- Admin Accounts ---
  async getAccounts(): Promise<UserAccount[]> {
    return [...this.users];
  }

  async updateAccountStatus(userId: string, newStatus: 'active' | 'disabled'): Promise<void> {
    const user = this.users.find((u) => u.user_id === userId);
    if (user) {
      user.status = newStatus;
      this.saveState();
      this.logAudit('approve', 'account', userId, `Admin changed account ${user.email} status to ${newStatus}`);
    }
  }

  // --- Study ---
  async getStudyParticipants(): Promise<StudyParticipant[]> {
    return [...this.participants];
  }

  async enrollParticipant(data: {
    sex: 'female' | 'male' | 'unspecified';
    age_band: '18-24' | '25-34' | '35-44' | '45-54' | '55+';
    venue: string;
  }): Promise<StudyParticipant> {
    const nextNum = (this.participants.length + 1).toString().padStart(3, '0');
    const code = `P${nextNum}`;
    const client_code = `SP${nextNum}K`;

    const newParticipant: StudyParticipant = {
      participant_id: 'sp-' + Math.random().toString(36).substring(2, 9),
      participant_code: code,
      sex: data.sex,
      age_band: data.age_band,
      venue: data.venue,
      client_code,
      enrolled_at: new Date().toISOString(),
      sets_captured: 0,
      readings_count: 0,
    };

    this.participants.push(newParticipant);
    this.saveState();
    this.logAudit('approve', 'study_participant', newParticipant.participant_id, `Enrolled participant ${code}`);
    return newParticipant;
  }

  async submitReferenceReading(data: {
    participant_code: string;
    reading_no: 1 | 2;
    values_mm: Record<SiteCode, number>;
  }): Promise<ReferenceReading> {
    const newReading: ReferenceReading = {
      reading_id: 'rr-' + Math.random().toString(36).substring(2, 9),
      participant_code: data.participant_code,
      measurer_code: this.currentUser?.measurer_code || 'A',
      reading_no: data.reading_no,
      values_mm: data.values_mm,
      taken_at: new Date().toISOString(),
      locked: true,
    };

    this.readings.push(newReading);
    const p = this.participants.find((item) => item.participant_code === data.participant_code);
    if (p) p.readings_count += 1;
    this.saveState();
    return newReading;
  }

  async getStudyCapturesCsv(): Promise<string> {
    const headers = [
      'participant_code',
      'captured_at',
      'scale_front_mm_px',
      'scale_disagreement_pct',
      'stature_cm',
      'shoulder_cm',
      'chest_cm',
      'waist_cm',
      'hip_cm',
      'sleeve_cm',
      'outleg_cm',
      'inleg_cm',
      'neck_cm',
    ];
    const rows = this.profiles.map((p) => {
      const getVal = (code: SiteCode) => {
        const m = p.measurements.find((x) => x.site_code === code);
        return m && m.value_mm ? (m.value_mm / 10).toFixed(1) : 'NA';
      };
      return [
        p.client_code,
        p.captured_at,
        p.session.scale_front_mm_px,
        p.session.scale_disagreement_pct,
        getVal('stature'),
        getVal('shoulder'),
        getVal('chest'),
        getVal('waist'),
        getVal('hip'),
        getVal('sleeve'),
        getVal('outleg'),
        getVal('inleg'),
        getVal('neck'),
      ].join(',');
    });
    return [headers.join(','), ...rows].join('\n');
  }

  async getStudyReferenceCsv(): Promise<string> {
    const headers = ['participant_code', 'measurer_code', 'reading_no', 'taken_at', 'site_code', 'value_cm'];
    const rows: string[] = [];
    this.readings.forEach((r) => {
      Object.entries(r.values_mm).forEach(([site, val]) => {
        rows.push([r.participant_code, r.measurer_code, r.reading_no, r.taken_at, site, (val / 10).toFixed(1)].join(','));
      });
    });
    return [headers.join(','), ...rows].join('\n');
  }
}

export const api = new ApiClient();
