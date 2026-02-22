# Driver Module Quick Start Guide

## Quick Overview

The Driver Module enables ambulance drivers to:
1. ✅ Receive emergency assignments in real-time
2. ✅ Accept or decline assignments
3. ✅ View patient medical information
4. ✅ Update emergency status through a workflow
5. ✅ Stream location in real-time

## Getting Started

### 1. Create a Driver Account

```
1. Tap "Create Account" on login screen
2. Select "Driver" role
3. Enter email and password
4. Confirm signup → Ready to login
```

### 2. Login as Driver

```
1. Enter email and password
2. Tap "Sign In"
3. System checks role and routes to /driver-home
4. You're now on the Driver Dashboard
```

### 3. Set Availability Status

```
1. On Driver Home, see "Driver Status" card
2. Toggle between "Available" ↔ "Offline"
3. Available Status:
   - ✅ Can receive emergency calls
   - ✅ GPS location being tracked
   - ✅ Alerts on new assignments
4. Offline Status:
   - ❌ Cannot receive calls
   - ❌ Location tracking stopped
```

## Workflow: Receiving & Managing Assignments

### Step 1: Assignment Alert
```
When emergency is assigned:
- Alert popup: "New Emergency"
- Assignment card appears on home screen
- Shows count of pending assignments
```

### Step 2: View Assignment Details
```
1. Tap "View Assignment" button
2. See emergency details:
   - Severity level (color-coded)
   - Location (latitude/longitude)
   - Description
   - Patient name and phone
3. Two buttons at bottom:
   - "Decline" (red)
   - "Accept" (blue)
```

### Step 3: Accept or Decline

**To Accept:**
```
1. Tap "Accept" button
2. System updates:
   - Assignment status → "accepted"
   - Emergency status → "assigned"
3. Navigates to Emergency Tracking screen
```

**To Decline:**
```
1. Tap "Decline" button
2. Confirm in alert dialog
3. Assignment returns to pending
4. Returns to driver home
```

## Emergency Workflow: Status Updates

### Status Timeline

Once you accept an emergency, you go through 7 states:

```
1️⃣  PENDING          (Initial - before driver accepts)
   ↓
2️⃣  ASSIGNED         (You accepted it)
   ↓
3️⃣  EN ROUTE         (Heading to patient location)
   ↓
4️⃣  AT SCENE         (Arrived and assessing patient)
   ↓
5️⃣  TRANSPORTING     (Patient in ambulance)
   ↓
6️⃣  AT HOSPITAL      (Arrived at hospital)
   ↓
7️⃣  COMPLETED        (Handoff to hospital staff done)
```

### Updating Status

```
1. On Emergency Tracking screen
2. See timeline of all 7 states
3. Current state highlighted in blue
4. Completed states show checkmarks ✓
5. "Next Action" button shows next status
6. Tap button to advance status
7. Repeat until "COMPLETED"
```

### Location Tracking

```
During:
- ✅ EN ROUTE
- ✅ AT SCENE
- ✅ TRANSPORTING

Location automatically updates every 10 seconds

You can toggle with "Location Tracking" button:
- ON: "Patient can see your location"
- OFF: "Patient cannot see your location"
```

## Viewing Patient Medical Data

### Access Medical Profile

```
While viewing emergency assignment:
1. Tap "View Medical Profile" button
2. See patient's medical information:
   - Contact info (primary phone, emergency contact)
   - Blood type (prominent)
   - Allergies (with warning)
   - Medical conditions
   - Emergency contact details
```

### Privacy Note

```
Medical data is RLS-protected:
- Only visible when you're assigned
- Automatically restricted
- Deleted from view on emergency close
```

## Real-time Features

### What Updates in Real-time?

1. **Assignment Alerts**
   - Instantly notified of new assignments
   - Real-time count updates
   - No need to refresh

2. **Emergency Status**
   - Automatically updated when status changes
   - Timeline updates instantly
   - No manual refresh needed

3. **Location Tracking**
   - Automatically sends every 10 seconds
   - No manual action needed
   - Stops when offline

## Common Tasks

### Task: Check if You Have Assignments

```
On Driver Home:
- Check "New Assignment!" card
- Shows number of pending assignments
- Alert appears automatically
```

### Task: Start a New Emergency Response

```
1. Make sure status is "Available"
2. Wait for alert (or check home screen)
3. Tap "View Assignment"
4. Review details
5. Tap "Accept"
6. Update status as you respond
```

### Task: Update Emergency Status

```
1. On Emergency Tracking screen
2. Check current state (blue highlight)
3. Tap "Next Action" button
4. Confirm status update
5. Timeline updates automatically
6. Repeat for each state
```

### Task: Stop Location Tracking

```
1. On Emergency Tracking screen
2. Find "Location Tracking" card
3. Toggle OFF
4. Status changes to "Inactive"
5. Toggle ON to resume
```

### Task: Logout

```
1. On Driver Home
2. Tap logout button (top right)
3. Confirm logout
4. Returns to login screen
```

## Screens & Navigation

### Screen 1: Driver Home (`/driver-home`)
- **Purpose**: Dashboard and status management
- **Shows**: Status toggle, assignment alert, stats
- **Actions**: Toggle status, view assignment, logout

### Screen 2: Emergency Assignment (`/driver-emergency`)
- **Purpose**: Review assignment details
- **Shows**: Severity, location, patient info
- **Actions**: Accept or decline

### Screen 3: Patient Medical Info (`/driver-patient-info`)
- **Purpose**: View patient medical data
- **Shows**: Contact, blood type, allergies, conditions
- **Actions**: View only (read-only)

### Screen 4: Emergency Tracking (`/driver-emergency-tracking`)
- **Purpose**: Manage emergency through workflow
- **Shows**: Timeline, status updates, location toggle
- **Actions**: Update status, control location tracking

## Tips & Best Practices

### ✅ Do's
- ✅ Set "Available" when ready for calls
- ✅ Accept assignments quickly
- ✅ Update status as you progress
- ✅ Check patient medical data
- ✅ Keep location tracking enabled
- ✅ Logout when going offline

### ❌ Don'ts
- ❌ Don't stay "Available" if offline
- ❌ Don't decline assignments frequently
- ❌ Don't forget to update status
- ❌ Don't ignore alerts
- ❌ Don't disable location tracking during response

## Troubleshooting

### Problem: Not Receiving Assignments

**Cause**: Status is "Offline"
**Solution**: Toggle to "Available" on Driver Home

### Problem: Location Not Updating

**Cause**: Location tracking disabled or permission not granted
**Solution**: Enable location toggle, check phone permissions

### Problem: Medical Profile Not Showing

**Cause**: Not assigned to an emergency yet
**Solution**: Accept an assignment first

### Problem: Can't Accept Assignment

**Cause**: App error or network issue
**Solution**: Refresh screen or try again

### Problem: Status Not Updating

**Cause**: Network connection lost
**Solution**: Check internet, try updating status again

## Support

### Getting Help
- Contact system admin
- Check app logs for errors
- Restart app if issues persist

### Reporting Issues
- Note what screen you're on
- Note what you were trying to do
- Include error message if any
- Contact support team

## Keyboard Shortcuts & Tips

### Faster Navigation
- Tap assignment alert to go directly to details
- Tap "Next Action" button to rapidly advance status
- Hold Location Toggle for 2 seconds to see tracking status

## Advanced Features

### Real-time Subscriptions
- System automatically subscribes to assignments
- Automatic updates (no polling)
- Unsubscribes when you logout

### Database RLS
- Patient data is protected
- Only visible when assigned
- Enforced at database level

### Location Privacy
- Location toggle is visible to patient
- Can enable/disable anytime
- Locations stored with timestamp

---

## Emergency Checklist

When emergency is assigned to you:

- [ ] Alert received on Driver Home
- [ ] Tap "View Assignment"
- [ ] Review severity and location
- [ ] Check patient medical data
- [ ] Tap "Accept"
- [ ] Update status to "EN ROUTE"
- [ ] Ensure location tracking enabled
- [ ] Arrive at scene
- [ ] Update status to "AT SCENE"
- [ ] Load patient into ambulance
- [ ] Update status to "TRANSPORTING"
- [ ] Head to hospital
- [ ] Arrive at hospital
- [ ] Update status to "AT HOSPITAL"
- [ ] Complete handoff
- [ ] Update status to "COMPLETED"
- [ ] Emergency closed, ready for next call

---

**Questions?** Contact the development team or system administrator.
