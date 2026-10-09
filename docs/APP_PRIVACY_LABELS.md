# App Store privacy answers ("App Privacy")

**App Store Connect → Afiyeat → App Privacy → Get Started.** These answers must match three other places: the Privacy Policy (`src/pages/Privacy.tsx`), the privacy manifest (`ios/App/App/PrivacyInfo.xcprivacy`), and what the app actually does. If the app starts collecting something new, update all four together.

Apple's meaning of "collect": data sent off the phone and kept longer than it takes to answer the request. "Linked" means tied to the account.

---

**Do you or your third-party partners collect data from this app?** → **Yes, we collect data from this app**

Select these data types:

| Category → type | Why it's collected | Purpose to tick | Linked to the user? | Used for tracking? |
|---|---|---|---|---|
| Contact Info → **Email Address** | Sign-in, sign-in codes, support | App Functionality | Yes | No |
| Contact Info → **Name** | Username and display name on the profile | App Functionality | Yes | No |
| User Content → **Photos or Videos** | Photos added to places, lists and recipes; photos sent for recipe scanning | App Functionality | Yes | No |
| User Content → **Other User Content** | Places, lists, notes, ratings, recipes, comments, reports | App Functionality | Yes | No |
| Identifiers → **User ID** | The account ID that owns everything | App Functionality | Yes | No |
| Location → **Precise Location** | Centring maps and nearby search, only if allowed; never stored on the account | App Functionality | **No** | No |

For every type: **"Is this data used to track the user?" → No.** For purposes, tick **only App Functionality**. Not Analytics, not Product Personalisation, not Third-Party Advertising, not Developer's Advertising.

**Leave everything else unselected:**
- Health & Fitness, Financial Info, Sensitive Info, Contacts, Purchases
- Browsing History; Search History (searches go to Apple Maps in real time and aren't kept)
- Usage Data, Diagnostics (there's no analytics or crash-reporting SDK)
- Device ID (notification permission isn't requested in this version, so no push tokens are collected)
- Audio, Gameplay, Emails or Text Messages, Coarse Location, Other Data

When finished, App Store Connect shows:
- **Data Linked to You:** Contact Info, User Content, Identifiers
- **Data Not Linked to You:** Location
- **Data Used to Track You:** none

---

**Revisit these answers when:**
- **notification prompts are switched on** (consider declaring Device ID for push tokens)
- **any analytics or crash reporting is added**
- **"Scan anything" ships**
- **a new third-party service is added**
