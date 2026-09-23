import Foundation
import Testing
@testable import GildongmuKit

/// 완료 순서를 테스트가 직접 정한다. 취소에 협조하지 않는 측위·전송도 재현한다.
@MainActor private final class AddressGate<Value: Sendable> {
    private var continuation: CheckedContinuation<Value, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []

    func value() async -> Value {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            observers.forEach { $0.resume() }
            observers.removeAll()
        }
    }

    func waitUntilRequested() async {
        if continuation != nil { return }
        await withCheckedContinuation { observers.append($0) }
    }

    func resume(_ value: Value) {
        precondition(continuation != nil)
        continuation?.resume(returning: value)
        continuation = nil
    }
}

@MainActor private final class AddressHarness {
    var state = DirectionsAddressState()
    var language = "en"
    var lookupCount = 0

    func loadIfNeeded(location: AddressGate<Void>, response: AddressGate<ReverseGeocodeResponse?>) -> Task<Void, Never>? {
        guard !state.hasLoaded, !state.isLoading else { return nil }
        return start(location: location, response: response)
    }

    func start(location: AddressGate<Void>, response: AddressGate<ReverseGeocodeResponse?>) -> Task<Void, Never> {
        let request = state.begin(language: language)
        return Task {
            defer { state.finish(request) }
            await location.value()
            guard state.accepts(request, language: language, isCancelled: Task.isCancelled) else { return }
            lookupCount += 1
            let result = await response.value()
            state.commit(result, for: request, language: language, isCancelled: Task.isCancelled)
        }
    }
}

@Suite @MainActor struct DirectionsAddressStateTests {
    private func response(_ original: String?, _ english: String?) -> ReverseGeocodeResponse {
        ReverseGeocodeResponse(address: original, addressEn: english)
    }

    @Test func reverseCompletionKeepsLatestPairAndIgnoresOldError() async {
        let harness = AddressHarness()
        let oldLocation = AddressGate<Void>(), newLocation = AddressGate<Void>()
        let oldResponse = AddressGate<ReverseGeocodeResponse?>(), newResponse = AddressGate<ReverseGeocodeResponse?>()
        let old = harness.start(location: oldLocation, response: oldResponse)
        await oldLocation.waitUntilRequested()
        oldLocation.resume(())
        await oldResponse.waitUntilRequested()
        let new = harness.start(location: newLocation, response: newResponse)
        await newLocation.waitUntilRequested()
        newLocation.resume(())
        await newResponse.waitUntilRequested()
        newResponse.resume(response("새 주소", "New address"))
        await new.value
        oldResponse.resume(response("이전 주소", "Old address"))
        await old.value
        #expect(harness.state.address.original == "새 주소")
        #expect(harness.state.address.english == "New address")
        #expect(harness.lookupCount == 2)
        let stale = harness.state.begin(language: "en")
        let latest = harness.state.begin(language: "en")
        harness.state.commit(response("최신", "Latest"), for: latest, language: "en", isCancelled: false)
        let staleCommitted = harness.state.commit(nil, for: stale, language: "en", isCancelled: false)
        #expect(!staleCommitted)
        #expect(harness.state.address.original == "최신")
    }

    @Test(arguments: [false, true])
    func lateLocationCannotStartLookupAfterInvalidation(cancelTask: Bool) async {
        let harness = AddressHarness()
        let location = AddressGate<Void>(), reply = AddressGate<ReverseGeocodeResponse?>()
        let task = harness.start(location: location, response: reply)
        await location.waitUntilRequested()
        if cancelTask { task.cancel() } else { harness.state.cancel() }
        location.resume(())
        await task.value
        #expect(harness.lookupCount == 0)
        #expect(!harness.state.hasLoaded)
        #expect(!harness.state.isLoading)
    }

    @Test func supersededLocationCannotLaunchNewAddressOrFinishNewRequest() async {
        let harness = AddressHarness()
        let oldLocation = AddressGate<Void>(), newLocation = AddressGate<Void>()
        let oldResponse = AddressGate<ReverseGeocodeResponse?>(), newResponse = AddressGate<ReverseGeocodeResponse?>()
        let old = harness.start(location: oldLocation, response: oldResponse)
        await oldLocation.waitUntilRequested()
        let new = harness.start(location: newLocation, response: newResponse)
        await newLocation.waitUntilRequested()
        newLocation.resume(())
        await newResponse.waitUntilRequested()
        oldLocation.resume(())
        await old.value
        #expect(harness.lookupCount == 1)
        #expect(harness.state.isLoading)
        newResponse.resume(response("새 주소", "New address"))
        await new.value
        #expect(harness.state.address.english == "New address")
    }

    @Test(arguments: [false, true])
    func lateAddressCannotCommitAfterCancellation(cancelTask: Bool) async {
        let harness = AddressHarness()
        let location = AddressGate<Void>(), reply = AddressGate<ReverseGeocodeResponse?>()
        let task = harness.start(location: location, response: reply)
        await location.waitUntilRequested()
        location.resume(())
        await reply.waitUntilRequested()
        if cancelTask { task.cancel() } else { harness.state.cancel() }
        reply.resume(response("늦은 주소", "Late"))
        await task.value
        #expect(harness.state.address.original == nil)
        #expect(harness.state.address.english == nil)
        #expect(!harness.state.hasLoaded)
    }

    @Test(arguments: [false, true])
    func cancelledInitialLoadRetriesOnReentry(cancelDuringAddress: Bool) async throws {
        let harness = AddressHarness()
        let oldLocation = AddressGate<Void>(), newLocation = AddressGate<Void>()
        let oldResponse = AddressGate<ReverseGeocodeResponse?>(), newResponse = AddressGate<ReverseGeocodeResponse?>()
        let old = try #require(harness.loadIfNeeded(location: oldLocation, response: oldResponse))
        await oldLocation.waitUntilRequested()
        if cancelDuringAddress {
            oldLocation.resume(())
            await oldResponse.waitUntilRequested()
        }
        harness.state.cancel()
        old.cancel()
        #expect(!harness.state.hasLoaded)
        // 옛 await가 끝나기 전에 재진입해도 새 조회가 시작되어야 한다.
        let new = try #require(harness.loadIfNeeded(location: newLocation, response: newResponse))
        await newLocation.waitUntilRequested()
        newLocation.resume(())
        await newResponse.waitUntilRequested()
        if cancelDuringAddress { oldResponse.resume(response("이전 주소", "Old")) }
        else { oldLocation.resume(()) }
        await old.value
        #expect(!harness.state.hasLoaded)
        #expect(harness.state.isLoading)
        #expect(harness.state.address.original == nil)
        newResponse.resume(response("재진입 주소", "Reloaded"))
        await new.value
        #expect(harness.state.hasLoaded)
        #expect(!harness.state.isLoading)
        #expect(harness.state.address.original == "재진입 주소")
        #expect(harness.state.address.english == "Reloaded")
        #expect(harness.lookupCount == (cancelDuringAddress ? 2 : 1))
        #expect(harness.loadIfNeeded(location: AddressGate<Void>(), response: AddressGate<ReverseGeocodeResponse?>()) == nil)
    }

    @Test(arguments: [false, true])
    func languageChangeRejectsLocationAndAddress(changeBeforeLocation: Bool) async {
        let harness = AddressHarness()
        let location = AddressGate<Void>(), reply = AddressGate<ReverseGeocodeResponse?>()
        let task = harness.start(location: location, response: reply)
        await location.waitUntilRequested()
        if changeBeforeLocation { harness.language = "ko" }
        location.resume(())
        if !changeBeforeLocation {
            await reply.waitUntilRequested()
            harness.language = "ko"
            reply.resume(response("주소", "Address"))
        }
        await task.value
        #expect(harness.state.address.original == nil)
        #expect(!harness.state.hasLoaded)
        #expect(!harness.state.isLoading)
        #expect(harness.lookupCount == (changeBeforeLocation ? 0 : 1))
    }

    @Test func latestMissingAddressOrErrorClearsBothAndCancelledRefreshPreservesBoth() {
        var state = DirectionsAddressState()
        let first = state.begin(language: "en")
        state.commit(response("주소", "Address"), for: first, language: "en", isCancelled: false)
        state.cancel()
        #expect(state.address.original == "주소" && state.address.english == "Address")
        for result in [response(nil, "Orphan English"), nil] {
            let request = state.begin(language: "en")
            let committed = state.commit(result, for: request, language: "en", isCancelled: false)
            #expect(committed)
            #expect(state.address.original == nil && state.address.english == nil)
            #expect(state.hasLoaded)
        }
    }

    /// stale-origin 재리뷰 N-3: 비우기는 완료 표식·요청 세대를 건드리지 않는다.
    @Test func clearAddressLeavesLoadedFlagAndRequestUntouched() {
        var state = DirectionsAddressState()
        let request = state.begin(language: "ko")
        state.clearAddress()
        #expect(state.address.original == nil && state.address.english == nil)
        #expect(!state.hasLoaded)
        #expect(state.isLoading)
        #expect(state.commit(response("주소", nil), for: request, language: "ko", isCancelled: false))
        #expect(state.address.original == "주소")
    }
}
