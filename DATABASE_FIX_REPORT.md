# Database Error Fix - User Registration Issue

## Problem

**Error**: `"Database error saving new user"`

**Root Cause**: The `profiles` table had a `NOT NULL` constraint on the `phone` field, but the signup form was not requiring users to enter a phone number before creating their account. This caused database constraint violations (error code 23502 - NOT NULL constraint).

## Solution

### 1. **Updated Database Schema** (`migrations/001_patient_schema.sql`)

**Changed**:
```sql
-- BEFORE: phone was required
phone TEXT NOT NULL,

-- AFTER: phone is now optional
phone TEXT,
```

**Impact**: Users can now create accounts without a phone number, though it's recommended for emergency services.

### 2. **Enhanced Registration Validation** (`app/register.tsx`)

**Changed validation flow**:
- Email ✅ Required
- Password ✅ Required (min 6 chars)
- Full Name ✅ Required
- Contact Number ⚠️ Recommended (shows warning if empty, user can proceed)

**New dialog**: If user tries to skip contact number, they get a warning alert:
```
"Contact number is recommended for emergency purposes. Continue anyway?"
[Go Back] [Continue]
```

### 3. **Improved Error Handling** (`utils/auth.ts`)

**Added specific error detection**:
- Error code `23505`: Duplicate key (profile already exists) → Treat as success
- Error code `23502`: NOT NULL constraint violation → Return proper error message
- Other database errors → Return descriptive error message

**Before**: Silently continued on profile creation failure
**After**: Returns proper error to user with detailed information

### 4. **Fixed Phone Field Handling** (`utils/auth.ts`)

**Changed**:
```typescript
// BEFORE: Could be undefined
phone,

// AFTER: Explicit null if empty
phone: phone || null,
```

## Testing the Fix

### Scenario 1: Create account with all fields
```
1. Email: test@example.com
2. Password: password123
3. Full Name: John Doe
4. Contact: 1234567890
5. Role: Patient
✅ Should succeed
```

### Scenario 2: Create account without contact
```
1. Email: test2@example.com
2. Password: password123
3. Full Name: Jane Doe
4. Contact: (empty)
5. Role: Driver
✅ Shows warning → Continue
✅ Should succeed
```

### Scenario 3: Duplicate email
```
1. Try to create account with existing email
✅ Should show error from Supabase auth
```

## Files Modified

1. **migrations/001_patient_schema.sql**
   - Made `phone` field optional (NULL allowed)

2. **app/register.tsx**
   - Updated validation logic
   - Made contact recommended, not required
   - Added warning dialog for missing contact

3. **utils/auth.ts**
   - Enhanced error detection (23502, 23505)
   - Fixed phone field handling
   - Returns proper error messages

## Backward Compatibility

✅ **Fully backward compatible**
- Existing user data unaffected
- Can still provide phone during signup
- NULL phone values handled gracefully

## Error Codes Reference

| Code | Meaning | Action |
|------|---------|--------|
| 23502 | NOT NULL constraint violation | Return error, ask user to fill required field |
| 23505 | Unique constraint violation (duplicate) | Treat as success if phone issue, else error |
| Other | Database error | Return descriptive error message |

## Prevention

To prevent similar issues in the future:

1. **Define all required fields early** in schema
2. **Validate before sending** to database
3. **Handle constraint errors gracefully** with user-friendly messages
4. **Make optional fields truly optional** in database
5. **Test edge cases** (missing fields, duplicates, etc.)

## Verification

After applying these fixes:

✅ Users can signup with all fields
✅ Users can signup without contact (with warning)
✅ Database errors return clear messages
✅ No null pointer exceptions
✅ Backward compatible with existing data

---

**Status**: ✅ FIXED
**Error Code**: Resolved
**User Impact**: Minimal (warning for optional contact)
