"""Pydantic shapes mirroring packages/contracts/openapi.yaml."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    field_validator,
    model_validator,
)

Email = Annotated[
    str, StringConstraints(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", to_lower=True)
]
Phone = Annotated[
    str, StringConstraints(pattern=r"^\+2547[0-9]{8}$|^\+2541[0-9]{8}$|^0[17][0-9]{8}$")
]
Locale = Literal["en", "sw"]
Unit = Literal["cm", "in"]
Role = Literal["tailor", "admin", "measurer"]
AccountStatus = Literal["pending", "active", "disabled", "rejected"]
Specialty = Literal[
    "kitenge", "suits", "dresses", "modest", "uniforms", "alterations", "traditional", "casual"
]


def _has_nul(value: Any) -> bool:
    if isinstance(value, str):
        return "\x00" in value
    if isinstance(value, dict):
        return any(_has_nul(key) or _has_nul(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_has_nul(item) for item in value)
    return False


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def refuse_nul_characters(cls, value: Any) -> Any:
        # PostgreSQL cannot store NUL, so it must stop here and not surface as a server error.
        if _has_nul(value):
            raise ValueError("NUL characters are not allowed")
        return value


class Status(BaseModel):
    status: Literal["ok", "unavailable"]


class PublicSettings(BaseModel):
    study_mode: bool
    consent_version: str
    min_app_version: str
    current_rules_version: str


class LoginInput(Input):
    email: Email
    password: str = Field(max_length=256)


class RegisterInput(Input):
    email: Email
    password: str = Field(min_length=10, max_length=256)
    business_name: str = Field(min_length=1, max_length=120)
    phone: Phone
    area: str = Field(max_length=120)
    locale: Locale


class RegisterResult(BaseModel):
    status: Literal["pending"]


class User(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=False)

    user_id: str
    email: str
    role: Role
    status: AccountStatus
    locale: Locale
    unit_pref: Unit
    business_name: str | None = None
    phone: str | None = None
    area: str | None = None
    measurer_code: str | None = None
    directory_listed: bool | None = None
    directory_show_phone: bool | None = None
    directory_specialties: list[Specialty] | None = None
    directory_description: str | None = None


class LoginResult(BaseModel):
    access_token: str
    expires_at: datetime
    user: User


class UserUpdate(Input):
    business_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: Phone | None = None
    area: str | None = Field(default=None, max_length=120)
    locale: Locale | None = None
    unit_pref: Unit | None = None
    directory_listed: bool | None = None
    directory_show_phone: bool | None = None
    directory_specialties: list[Specialty] | None = Field(default=None, max_length=8)
    directory_description: str | None = Field(default=None, max_length=240)

    @field_validator("directory_specialties")
    @classmethod
    def no_repeats(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Specialties must not repeat")
        return value


class PasswordChange(Input):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


class ClientCodeCheck(BaseModel):
    valid: bool
    tailor_business_name: str
    height_mm: int | None


class TailorListing(BaseModel):
    listing_id: str
    business_name: str
    area: str
    specialties: list[Specialty]
    description: str | None
    phone: str | None


class TailorListingPage(BaseModel):
    items: list[TailorListing]
    page: int
    page_size: int
    total: int
    areas: list[str]


class DirectoryCodeIssued(BaseModel):
    client_code: str
    tailor_business_name: str


class DirectoryClient(BaseModel):
    client_id: str
    client_code: str
    created_at: datetime
    has_profile: bool


class DirectoryClientPage(BaseModel):
    items: list[DirectoryClient]
    page: int
    page_size: int
    total: int
    unused_total: int


class DirectoryClientsRemoved(BaseModel):
    removed: int


# --- Measurement profiles (backend-spec 9). Numbers are strict: "1" and true are not numbers.


def _timestamp_text(value: Any) -> Any:
    if not isinstance(value, str) or len(value) > 32:
        raise ValueError("A date and time as text is required")
    return value


Depth = Annotated[float, Field(strict=True, ge=-10, le=10, allow_inf_nan=False)]
DistanceM = Annotated[float, Field(strict=True, ge=1.5, le=3.5, allow_inf_nan=False)]
Fraction = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
HeightMm = Annotated[int, Field(strict=True, ge=1200, le=2200)]
ImageSide = Annotated[int, Field(strict=True, ge=1, le=8192)]
LevelFraction = Annotated[float, Field(strict=True, ge=0, le=2, allow_inf_nan=False)]
Lux = Annotated[int, Field(strict=True, ge=0, le=200000)]
MemoryGb = Annotated[float, Field(strict=True, ge=0, le=64, allow_inf_nan=False)]
Millis = Annotated[int, Field(strict=True, ge=0, le=600000)]
Mm = Annotated[float, Field(strict=True, ge=0, le=400, allow_inf_nan=False)]
NormalPlace = Annotated[float, Field(strict=True, ge=-0.5, le=1.5, allow_inf_nan=False)]
Percent = Annotated[float, Field(strict=True, ge=0, le=100, allow_inf_nan=False)]
Pixel = Annotated[float, Field(strict=True, ge=0, le=8192, allow_inf_nan=False)]
Retakes = Annotated[int, Field(strict=True, ge=0, le=100)]
SetNo = Annotated[int, Field(strict=True, ge=1, le=3)]
Text20 = Annotated[str, StringConstraints(strict=True, max_length=20)]
Text64 = Annotated[str, StringConstraints(strict=True, max_length=64)]
Text80 = Annotated[str, StringConstraints(strict=True, max_length=80)]
ValueMm = Annotated[int, Field(strict=True, ge=100, le=3000)]
Version = Annotated[int, Field(strict=True, ge=1, le=100000)]
Scale = Annotated[float, Field(strict=True, gt=0, le=100, allow_inf_nan=False)]
CorrectionFactor = Annotated[float, Field(strict=True, gt=0, le=10, allow_inf_nan=False)]
Stamp = Annotated[AwareDatetime, BeforeValidator(_timestamp_text)]
ClientCode = Annotated[str, StringConstraints(strict=True, pattern=r"^[A-Z]{2}[0-9]{4}$")]
RulesVersionName = Annotated[
    str, StringConstraints(strict=True, pattern=r"^[0-9]+\.[0-9]+-[a-z0-9-]+$", max_length=40)
]
ParticipantCode = Annotated[str, StringConstraints(strict=True, pattern=r"^P[0-9]{3}$")]
SiteCode = Literal[
    "stature", "shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck"
]
Flag = Literal["pass", "check", "fail"]
FlagReason = Literal[
    "scale_disagree",
    "level_unchecked",
    "loose_clothing",
    "landmark_low",
    "mask_gap",
    "out_of_range",
    "crotch_not_found",
    "marker_weak",
    "waist_level_mismatch",
    "chest_level_mismatch",
    "view_failed",
    "free_arm_unknown",
]
ClothingFit = Literal["fitted", "loose"]
CheckState = Literal["pass", "fail", "skipped"]
MmProfile = Annotated[list[Mm | None], Field(min_length=101, max_length=101)]


def _whole_tenths(values: list[float | None]) -> list[float | None]:
    """The phone rounds to 0.1 (F1). Anything finer is room to hide other data in."""
    for value in values:
        if value is not None and abs(value * 10 - round(value * 10)) > 1e-6:
            raise ValueError("Finer than 0.1 is not accepted")
    return values


class Landmark(Input):
    x: NormalPlace
    y: NormalPlace
    z: Depth
    visibility: Fraction


LandmarkSet = Annotated[list[Landmark], Field(min_length=33, max_length=33)]


class MarkerObs(Input):
    corners: Annotated[
        list[Annotated[list[Pixel], Field(min_length=2, max_length=2)]],
        Field(min_length=4, max_length=4),
    ]
    image_w: ImageSide
    image_h: ImageSide
    side_px: Pixel
    confidence: Fraction

    @model_validator(mode="after")
    def corners_inside_the_image(self) -> "MarkerObs":
        if any(x > self.image_w or y > self.image_h for x, y in self.corners):
            raise ValueError("A marker corner is outside the image")
        return self


class SilhouetteFront(Input):
    samples: Literal[101]
    mask_top_px: Pixel
    mask_bottom_px: Pixel
    image_w: ImageSide
    image_h: ImageSide
    half_width_mm: MmProfile
    crotch_y_px: Pixel | None
    centre_x_px: Annotated[list[Pixel | None], Field(min_length=101, max_length=101)] = None  # type: ignore[assignment]

    _tenths = field_validator("half_width_mm", "centre_x_px")(_whole_tenths)


class SilhouetteSide(Input):
    samples: Literal[101]
    mask_top_px: Pixel
    mask_bottom_px: Pixel
    image_w: ImageSide
    image_h: ImageSide
    half_depth_mm: MmProfile
    anterior_mm: MmProfile

    _tenths = field_validator("half_depth_mm", "anterior_mm")(_whole_tenths)


class ViewChecks(Input):
    level: CheckState
    frame: CheckState
    distance: CheckState
    symmetry: CheckState
    arms: CheckState
    marker: CheckState
    light: CheckState
    sharpness: CheckState


class StudyBlock(Input):
    participant_code: ParticipantCode
    set_no: SetNo
    lighting: Literal["window", "lamp", "outdoor"]
    distance_m: DistanceM
    clothing_fit_observed: ClothingFit
    lux: Lux = None  # type: ignore[assignment]


class CaptureSession(Input):
    session_id: uuid.UUID
    started_at: Stamp
    capture_mode: Literal["self", "assisted"]
    camera_facing: Literal["environment", "user"]
    guidance_mode: Literal["voice", "visual"]
    free_arm: Literal["left", "right"] | None
    app_version: Text20
    device_model: Text64
    os: Text64
    browser: Text64
    memory_gb: MemoryGb | None
    model_variant: Literal["lite", "full", "heavy"]
    stream_w: ImageSide
    stream_h: ImageSide
    still_source: Literal["imagecapture", "canvas", "file"]
    level_unchecked: StrictBool
    capture_fallback: StrictBool
    front_checks: ViewChecks
    side_checks: ViewChecks
    scale_front_mm_px: Scale
    scale_side_mm_px: Scale
    scale_stature_mm_px: Scale
    scale_disagreement_pct: Percent
    processing_ms: Millis
    retake_count: Retakes
    config_hash: Text80
    study: StudyBlock = None  # type: ignore[assignment]


class Covariates(Input):
    height_mm_entered: HeightMm
    sex: Literal["female", "male", "unspecified"]
    clothing_fit: ClothingFit
    code_verified: StrictBool


class ConsentRecord(Input):
    consent_version: Text20
    language: Locale
    scope: Annotated[
        list[Literal["measure", "measurements_only", "retention", "study_paper"]],
        Field(max_length=4),
    ]
    given_at: Stamp
    withdrawn_at: Stamp = None  # type: ignore[assignment]

    @field_validator("scope")
    @classmethod
    def scope_is_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("The scope has a repeated item")
        return value


class Measurement(Input):
    """In an auto row, value_mm is null if and only if the flag is fail (C4)."""

    site_code: SiteCode
    value_mm: ValueMm | None
    method: Literal["auto", "override"]
    confidence_flag: Flag
    flag_reasons: Annotated[list[FlagReason], Field(max_length=12)]
    correction_factor: CorrectionFactor = None  # type: ignore[assignment]
    level_fraction: LevelFraction = None  # type: ignore[assignment]
    half_width_mm: Mm = None  # type: ignore[assignment]
    half_depth_mm: Mm = None  # type: ignore[assignment]

    @field_validator("flag_reasons")
    @classmethod
    def reasons_are_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("A reason is repeated")
        return value

    @model_validator(mode="after")
    def value_matches_flag(self) -> "Measurement":
        if self.value_mm is None and self.confidence_flag != "fail":
            raise ValueError("Only a failed site can have no value")
        if self.method == "auto" and self.value_mm is not None and self.confidence_flag == "fail":
            raise ValueError("A failed site has no value")
        return self


MAX_FUTURE = timedelta(minutes=10)
MAX_AGE = timedelta(days=90)


class MeasurementProfilePayload(Input):
    profile_id: uuid.UUID
    client_code: ClientCode
    version: Version
    captured_at: Stamp
    status: Literal["final"]
    rules_version: RulesVersionName
    covariates: Covariates
    consent: ConsentRecord
    session: CaptureSession
    landmarks_front: LandmarkSet
    landmarks_side: LandmarkSet
    marker_front: MarkerObs
    marker_side: MarkerObs
    silhouette_front: SilhouetteFront
    silhouette_side: SilhouetteSide
    measurements: Annotated[list[Measurement], Field(min_length=9, max_length=9)]

    @field_validator("measurements")
    @classmethod
    def nine_different_sites(cls, value: list[Measurement]) -> list[Measurement]:
        if len({row.site_code for row in value}) != 9:
            raise ValueError("Each site appears once")
        if any(row.method != "auto" for row in value):
            raise ValueError("An override comes from the tailor, not from a phone")
        return value

    @field_validator("captured_at")
    @classmethod
    def captured_recently(cls, value: datetime) -> datetime:
        now = datetime.now(UTC)
        if value > now + MAX_FUTURE or value < now - MAX_AGE:
            raise ValueError("The capture time is out of range")
        return value


class ServerCheck(BaseModel):
    kind: str
    severity: Literal["info", "check"]
    site_code: SiteCode | None
    detail: dict[str, float | str | None]


class ProfileAccepted(BaseModel):
    profile_id: str
    version: int
    server_checks: list[ServerCheck]


class DeletionRequestInput(Input):
    client_code: ClientCode
    reason: Literal["delete", "withdraw_consent"]


class DeletionRequestReceipt(BaseModel):
    request_id: str
    status: Literal["received", "partially_done", "done", "rejected"]
    note: str | None = None


class AccessRequestInput(Input):
    client_code: ClientCode


class MeasurementProfile(BaseModel):
    profile_id: str
    client_id: str
    client_code: str
    version: int
    captured_at: datetime
    received_at: datetime
    status: Literal["final", "conflict", "superseded", "deleted"]
    rules_version: str
    covariates: Covariates
    consent: ConsentRecord
    session: CaptureSession
    landmarks_front: list[Landmark]
    landmarks_side: list[Landmark]
    marker_front: MarkerObs
    marker_side: MarkerObs
    silhouette_front: SilhouetteFront | None
    silhouette_side: SilhouetteSide | None
    measurements: list[Measurement]
    server_checks: list[ServerCheck]


class ClientDataExport(BaseModel):
    client_code: str
    profiles: list[MeasurementProfile]
    consents: list[ConsentRecord]
    order_count: int


class RulesArtifact(BaseModel):
    model_config = ConfigDict(extra="allow")

    rules_version: str
    status: Literal["draft", "frozen", "retired"]
    checksum: str
