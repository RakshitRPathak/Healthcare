export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';
export interface Me { id: string; email: string; role: Role; name: string; timezone: string; specialty?: string; slotMinutes?: number; calendarConnected?: boolean; calendarAvailable?: boolean }
export interface Doctor { id: string; name: string; specialty: string; timezone: string; slot_minutes: number }
export interface Slot { startAt: string; endAt: string }
export type ApptStatus = 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'CANCELLED_LEAVE' | 'COMPLETED' | 'NO_SHOW' | 'EXPIRED';
export interface Appointment { id: string; doctor_id: string; patient_id: string; start_at: string; end_at: string; status: ApptStatus; reason: string | null; hold_expires_at: string | null; doctor_name: string; patient_name: string }
export interface Medication { id: string; name: string; dosage: string; instructions: string | null; times_of_day: string[]; start_date: string; end_date: string; next_reminder_at: string | null; doctor_name: string }
export interface PreContent { chiefComplaint: string; relevantHistory: string[]; currentMedications: string[]; allergies: string[]; suggestedQuestions: string[]; flags: string[] }
export interface PostContent { summary: string; findings: string; instructions: string[]; medications: { name: string; dosage: string; howToTake: string }[]; followUp: string; whenToSeekCare: string[] }
export interface Summary { id: string; kind: 'PRE' | 'POST'; status: 'PENDING' | 'GENERATED' | 'FALLBACK'; source: 'llm' | 'fallback' | 'doctor' | null; content: PreContent | PostContent | null; approved_at: string | null }
export interface Leave { id: string; starts_at: string; ends_at: string; reason: string | null }
