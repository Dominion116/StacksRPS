;; -------------------------------------------------------
;; Constants
;; -------------------------------------------------------

(define-constant ERR-GAME-NOT-FOUND     (err u100))
(define-constant ERR-GAME-FULL          (err u101))
(define-constant ERR-NOT-YOUR-GAME      (err u102))
(define-constant ERR-ALREADY-REVEALED   (err u103))
(define-constant ERR-BAD-COMMIT         (err u104))
(define-constant ERR-INVALID-MOVE       (err u105))
(define-constant ERR-NOT-READY          (err u106))
(define-constant ERR-SAME-PLAYER        (err u107))
(define-constant ERR-GAME-OVER          (err u108))
(define-constant ERR-NOT-EXPIRED        (err u109))

;; Moves encoded as uint
;; 0 = None (not yet revealed)
;; 1 = Rock
;; 2 = Paper
;; 3 = Scissors
(define-constant MOVE-NONE      u0)
(define-constant MOVE-ROCK      u1)
(define-constant MOVE-PAPER     u2)
(define-constant MOVE-SCISSORS  u3)

;; Game status
(define-constant STATUS-WAITING  u0)  ;; waiting for p2 to join
(define-constant STATUS-ACTIVE   u1)  ;; both joined, waiting for reveals
(define-constant STATUS-DONE     u2)  ;; game finished

;; Reveal timeout — p2 has 144 blocks (~24hrs on Stacks) to reveal
(define-constant REVEAL-TIMEOUT u144)

;; -------------------------------------------------------
;; Data Maps
;; -------------------------------------------------------

(define-map games
  { game-id: uint }
  {
    p1:         principal,
    p2:         (optional principal),
    p1-commit:  (buff 32),
    p2-commit:  (optional (buff 32)),
    p1-move:    uint,
    p2-move:    uint,
    status:     uint,
    winner:     (optional principal),
    created-at: uint    ;; block height
  }
)

;; Track wins and draws per player
(define-map player-stats
  { player: principal }
  { wins: uint, losses: uint, draws: uint, games-played: uint }
)

;; -------------------------------------------------------
;; Data Variables
;; -------------------------------------------------------

(define-data-var game-count uint u0)

;; -------------------------------------------------------
;; Private Helpers
;; -------------------------------------------------------

;; Determine winner: returns 0=draw, 1=p1 wins, 2=p2 wins
(define-private (get-winner (p1-move uint) (p2-move uint))
  (if (is-eq p1-move p2-move)
    u0  ;; draw
    (if (or
          (and (is-eq p1-move MOVE-ROCK)     (is-eq p2-move MOVE-SCISSORS))
          (and (is-eq p1-move MOVE-PAPER)    (is-eq p2-move MOVE-ROCK))
          (and (is-eq p1-move MOVE-SCISSORS) (is-eq p2-move MOVE-PAPER))
        )
      u1  ;; p1 wins
      u2  ;; p2 wins
    )
  )
)

;; Validate move is 1, 2, or 3
(define-private (valid-move (move uint))
  (and (>= move u1) (<= move u3))
)

;; Get or default player stats
(define-private (get-stats (player principal))
  (default-to
    { wins: u0, losses: u0, draws: u0, games-played: u0 }
    (map-get? player-stats { player: player })
  )
)

;; Update stats for both players after a game
(define-private (update-stats (p1 principal) (p2 principal) (result uint))
  (let (
    (s1 (get-stats p1))
    (s2 (get-stats p2))
  )
    (if (is-eq result u0)
      ;; draw
      (begin
        (map-set player-stats { player: p1 }
          (merge s1 { draws: (+ (get draws s1) u1), games-played: (+ (get games-played s1) u1) }))
        (map-set player-stats { player: p2 }
          (merge s2 { draws: (+ (get draws s2) u1), games-played: (+ (get games-played s2) u1) }))
      )
      (if (is-eq result u1)
        ;; p1 wins
        (begin
          (map-set player-stats { player: p1 }
            (merge s1 { wins: (+ (get wins s1) u1), games-played: (+ (get games-played s1) u1) }))
          (map-set player-stats { player: p2 }
            (merge s2 { losses: (+ (get losses s2) u1), games-played: (+ (get games-played s2) u1) }))
        )
        ;; p2 wins
        (begin
          (map-set player-stats { player: p1 }
            (merge s1 { losses: (+ (get losses s1) u1), games-played: (+ (get games-played s1) u1) }))
          (map-set player-stats { player: p2 }
            (merge s2 { wins: (+ (get wins s2) u1), games-played: (+ (get games-played s2) u1) }))
        )
      )
    )
  )
)

;; -------------------------------------------------------
;; Public Functions
;; -------------------------------------------------------

;; Step 1: Player 1 creates a game with a commit hash
;; Commit = sha256(move + salt)
;; e.g. sha256(concat(0x01, your-random-32-bytes))
(define-public (create-game (commit (buff 32)))
  (let (
    (id (var-get game-count))
  )
    (map-set games { game-id: id }
      {
        p1:         tx-sender,
        p2:         none,
        p1-commit:  commit,
        p2-commit:  none,
        p1-move:    MOVE-NONE,
        p2-move:    MOVE-NONE,
        status:     STATUS-WAITING,
        winner:     none,
        created-at: block-height
      }
    )
    (var-set game-count (+ id u1))
    (ok id)
  )
)

;; Step 2: Player 2 joins and also submits a commit
(define-public (join-game (game-id uint) (commit (buff 32)))
  (let (
    (game (unwrap! (map-get? games { game-id: game-id }) ERR-GAME-NOT-FOUND))
  )
    (asserts! (is-eq (get status game) STATUS-WAITING)  ERR-GAME-FULL)
    (asserts! (not (is-eq tx-sender (get p1 game)))     ERR-SAME-PLAYER)

    (map-set games { game-id: game-id }
      (merge game {
        p2:        (some tx-sender),
        p2-commit: (some commit),
        status:    STATUS-ACTIVE
      })
    )
    (ok true)
  )
)

;; Step 3: Each player reveals their move and salt
;; Move: u1=Rock, u2=Paper, u3=Scissors
(define-public (reveal (game-id uint) (move uint) (salt (buff 32)))
  (let (
    (game  (unwrap! (map-get? games { game-id: game-id }) ERR-GAME-NOT-FOUND))
    (p1    (get p1 game))
    (p2    (unwrap! (get p2 game) ERR-NOT-READY))
    (is-p1 (is-eq tx-sender p1))
    (is-p2 (is-eq tx-sender p2))
    (commit (sha256 (concat (if (is-eq move u1) 0x01 (if (is-eq move u2) 0x02 0x03)) salt)))
  )
    (asserts! (is-eq (get status game) STATUS-ACTIVE) ERR-GAME-OVER)
    (asserts! (valid-move move)                        ERR-INVALID-MOVE)
    (asserts! (or is-p1 is-p2)                        ERR-NOT-YOUR-GAME)

    ;; Verify commit matches
    (if is-p1
      (begin
        (asserts! (is-eq (get p1-move game) MOVE-NONE) ERR-ALREADY-REVEALED)
        (asserts! (is-eq commit (get p1-commit game))  ERR-BAD-COMMIT)
        (map-set games { game-id: game-id } (merge game { p1-move: move }))
      )
      (begin
        (asserts! (is-eq (get p2-move game) MOVE-NONE) ERR-ALREADY-REVEALED)
        (asserts! (is-eq commit (unwrap! (get p2-commit game) ERR-BAD-COMMIT)) ERR-BAD-COMMIT)
        (map-set games { game-id: game-id } (merge game { p2-move: move }))
      )
    )

    ;; Re-fetch updated game and check if both revealed
    (let (
      (updated (unwrap! (map-get? games { game-id: game-id }) ERR-GAME-NOT-FOUND))
      (p1m (get p1-move updated))
      (p2m (get p2-move updated))
    )
      (if (and (not (is-eq p1m MOVE-NONE)) (not (is-eq p2m MOVE-NONE)))
        ;; Both revealed — resolve
        (let (
          (result (get-winner p1m p2m))
          (winner-opt (if (is-eq result u0)
                       none
                       (some (if (is-eq result u1) p1 p2))))
        )
          (update-stats p1 p2 result)
          (map-set games { game-id: game-id }
            (merge updated { status: STATUS-DONE, winner: winner-opt })
          )
          (ok result)
        )
        (ok u99) ;; u99 = waiting for other player to reveal
      )
    )
  )
)

;; -------------------------------------------------------
;; Read-Only Functions
;; -------------------------------------------------------

(define-read-only (get-game (game-id uint))
  (map-get? games { game-id: game-id })
)

(define-read-only (get-player-stats (player principal))
  (get-stats player)
)

(define-read-only (get-total-games)
  (var-get game-count)
)

;; Returns the move name as a string for UI display
(define-read-only (move-name (move uint))
  (if (is-eq move MOVE-ROCK)     "Rock"
  (if (is-eq move MOVE-PAPER)    "Paper"
  (if (is-eq move MOVE-SCISSORS) "Scissors"
  "None")))
)
