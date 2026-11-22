import Foundation
import UIKit
import Capacitor
import AuthenticationServices
import CryptoKit

/// The app's own bridge view controller (set in Main.storyboard). It is
/// Capacitor's standard one plus a single line that registers the app's
/// in-target plugin below - Capacitor's documented way to ship custom
/// native code without a separate npm package.
class AfiyeatBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AfiyeatAuthPlugin())
    }
}

/// Native sign-in helpers used by src/lib/socialAuth/nativeAuth.ts.
///
/// - signInWithApple: Apple's own Sign in with Apple sheet
///   (ASAuthorizationController). The page passes a random nonce; Apple is
///   given its SHA-256, so the identity token it returns can be used once,
///   for this attempt only. Returns the identity token; the backend checks
///   it against Apple's keys.
/// - openAuthSession: opens a sign-in page (Google) in
///   ASWebAuthenticationSession - the system browser sheet, never an
///   embedded web view - and returns the callback URL it is redirected to.
///   The sheet hands that URL only to this app.
///
/// Rejection codes: CANCELLED (the person backed out), UNAVAILABLE, FAILED.
/// Nothing here logs or stores tokens.
@objc(AfiyeatAuthPlugin)
public class AfiyeatAuthPlugin: CAPPlugin, CAPBridgedPlugin,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding,
    ASWebAuthenticationPresentationContextProviding {

    public let identifier = "AfiyeatAuthPlugin"
    public let jsName = "AfiyeatAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAuthSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAppleCredentialState", returnType: CAPPluginReturnPromise),
    ]

    // Touched only on the main queue.
    private var appleCall: CAPPluginCall?
    private var appleController: ASAuthorizationController?
    private var webCall: CAPPluginCall?
    private var webSession: ASWebAuthenticationSession?

    // MARK: Sign in with Apple

    @objc func signInWithApple(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), nonce.count >= 32 else {
            call.reject("A nonce is required.", "FAILED")
            return
        }
        DispatchQueue.main.async {
            if self.appleCall != nil {
                call.reject("Sign in with Apple is already open.", "FAILED")
                return
            }
            self.appleCall = call

            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = AfiyeatAuthPlugin.sha256Hex(nonce)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.appleController = controller
            controller.performRequests()
        }
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = appleCall else { return }
        appleCall = nil
        appleController = nil

        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple didn't return an identity token.", "FAILED")
            return
        }

        var result: [String: Any] = ["identityToken": token, "user": credential.user]
        // The Apple client id this code was issued to; the server must use the
        // same one to exchange and revoke it (account deletion).
        if let bundleId = Bundle.main.bundleIdentifier { result["clientId"] = bundleId }
        if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) {
            result["authorizationCode"] = code
        }
        // Apple shares email and name only on the first authorisation.
        if let email = credential.email { result["email"] = email }
        if let given = credential.fullName?.givenName { result["givenName"] = given }
        if let family = credential.fullName?.familyName { result["familyName"] = family }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithError error: Error) {
        guard let call = appleCall else { return }
        appleCall = nil
        appleController = nil

        let nsError = error as NSError
        var code = "FAILED"
        var message = "Sign in with Apple didn't complete."
        if nsError.domain == ASAuthorizationError.errorDomain {
            switch nsError.code {
            case ASAuthorizationError.Code.canceled.rawValue:
                code = "CANCELLED"
                message = "cancelled"
            case ASAuthorizationError.Code.unknown.rawValue:
                // Seen when the device isn't signed in to an Apple Account,
                // or the build lacks the Sign in with Apple capability.
                code = "UNAVAILABLE"
                message = "Sign in with Apple is unavailable on this device."
            default:
                break
            }
        }
        call.reject(message, code)
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return currentAnchor()
    }

    // MARK: Credential state

    /// Apple TN3194: when someone stops using Sign in with Apple for the app in
    /// Settings, the app should return to a signed-out state. The page calls
    /// this on launch and when the app comes back to the foreground.
    @objc func getAppleCredentialState(_ call: CAPPluginCall) {
        guard let user = call.getString("user"), !user.isEmpty else {
            call.reject("An Apple user id is required.", "FAILED")
            return
        }
        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: user) { state, _ in
            let name: String
            switch state {
            case .authorized: name = "authorized"
            case .revoked: name = "revoked"
            case .notFound: name = "notFound"
            case .transferred: name = "transferred"
            @unknown default: name = "unknown"
            }
            call.resolve(["state": name])
        }
    }

    // MARK: System browser sheet (Google)

    @objc func openAuthSession(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              url.scheme == "https",
              url.path.contains("/auth/v1/") else {
            call.reject("Not a sign-in address.", "FAILED")
            return
        }
        guard let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("A callback scheme is required.", "FAILED")
            return
        }
        DispatchQueue.main.async {
            if self.webCall != nil {
                call.reject("Sign-in is already open.", "FAILED")
                return
            }
            self.webCall = call

            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                DispatchQueue.main.async {
                    self?.finishWebSession(callbackURL: callbackURL, error: error)
                }
            }
            session.presentationContextProvider = self
            // Shared with Safari, so someone already signed in to Google
            // there doesn't retype their password. The page is asked to
            // show Google's account chooser, so after signing out of
            // Afiyeat a different Google account can still be picked.
            session.prefersEphemeralWebBrowserSession = false
            self.webSession = session
            if !session.start() {
                self.webCall = nil
                self.webSession = nil
                call.reject("Couldn't open the sign-in page.", "FAILED")
            }
        }
    }

    private func finishWebSession(callbackURL: URL?, error: Error?) {
        guard let call = webCall else { return }
        webCall = nil
        webSession = nil

        if let error = error {
            let nsError = error as NSError
            if nsError.domain == ASWebAuthenticationSessionError.errorDomain,
               nsError.code == ASWebAuthenticationSessionError.Code.canceledLogin.rawValue {
                call.reject("cancelled", "CANCELLED")
            } else {
                call.reject("The sign-in page didn't complete.", "FAILED")
            }
            return
        }
        guard let callbackURL = callbackURL else {
            call.reject("The sign-in page returned nothing.", "FAILED")
            return
        }
        call.resolve(["url": callbackURL.absoluteString])
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return currentAnchor()
    }

    // MARK: Helpers

    private func currentAnchor() -> ASPresentationAnchor {
        if let window = bridge?.webView?.window {
            return window
        }
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
        return windows.first(where: { $0.isKeyWindow }) ?? windows.first ?? ASPresentationAnchor()
    }

    private static func sha256Hex(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
