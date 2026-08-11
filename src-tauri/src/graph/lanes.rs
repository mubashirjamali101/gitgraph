//! Lane assignment.
//!
//! Two properties matter, and both are about what the renderer can do with the
//! output:
//!
//! 1. **Lanes are freed and reused.** A lane belongs to a chain of commits, and
//!    the moment that chain ends (its last commit is reached) the slot is
//!    available again. Width therefore tracks *concurrently open* branches
//!    rather than branches-ever-seen.
//!
//! 2. **Rows are self-describing.** Each row carries the line segments drawn in
//!    the band between its own centre and the next row's centre. Drawing any
//!    window of rows needs nothing but those rows, so a virtualized renderer
//!    can never disagree with the list it is drawing next to.

use serde::Serialize;

/// Number of distinct lane colours; matches the palette in the frontend theme.
pub const PALETTE_SIZE: usize = 8;

/// A line in the band below a row. `from == to` is a straight run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Segment {
    pub from: usize,
    pub to: usize,
    pub color: usize,
}

/// Lane geometry for one commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowLayout {
    pub lane: usize,
    pub color: usize,
    pub segments: Vec<Segment>,
}

/// Minimal commit shape the layout needs.
pub trait CommitNode {
    fn id(&self) -> &str;
    fn parents(&self) -> &[String];
}

/// Lane assignment state. Public and cloneable so an incremental walk can pick
/// up exactly where the previous chunk left off — lanes must stay continuous
/// across the join or the graph would restart at every page boundary.
#[derive(Default, Clone)]
pub struct LaneState {
    /// The commit each lane is waiting for; `None` means the slot is free.
    waiting: Vec<Option<String>>,
    colors: Vec<usize>,
    next_color: usize,
    max_width: usize,
}

impl LaneState {
    fn free_slot(&mut self) -> usize {
        if let Some(index) = self.waiting.iter().position(Option::is_none) {
            return index;
        }
        self.waiting.push(None);
        self.colors.push(0);
        self.waiting.len() - 1
    }

    fn find(&self, sha: &str) -> Option<usize> {
        self.waiting.iter().position(|slot| slot.as_deref() == Some(sha))
    }

    fn take_color(&mut self) -> usize {
        let color = self.next_color % PALETTE_SIZE;
        self.next_color += 1;
        color
    }

    fn trim(&mut self) {
        while matches!(self.waiting.last(), Some(None)) {
            self.waiting.pop();
            self.colors.pop();
        }
    }

    pub fn place<C: CommitNode>(&mut self, commit: &C) -> RowLayout {
        let lane = match self.find(commit.id()) {
            Some(index) => index,
            None => {
                let index = self.free_slot();
                self.colors[index] = self.take_color();
                index
            }
        };
        let color = self.colors[lane];
        let mut segments = Vec::new();

        self.waiting[lane] = None;

        // Which lanes were already running alongside this row, captured before
        // its parents are scheduled. A lane this commit opens for a merge is
        // *not* one of them: it starts here, so it gets the merge segment only.
        // Treating it as a pass-through as well drew a second, straight line
        // from the commit's own row into empty space above the branch.
        let passing: Vec<bool> = self.waiting.iter().map(Option::is_some).collect();

        let parents = commit.parents();
        if let Some(first) = parents.first() {
            match self.find(first) {
                // The chain merges into a lane that is already open: draw across.
                Some(existing) => segments.push(Segment { from: lane, to: existing, color }),
                None => {
                    self.waiting[lane] = Some(first.clone());
                    self.colors[lane] = color;
                    segments.push(Segment { from: lane, to: lane, color });
                }
            }
        }

        for parent in parents.iter().skip(1) {
            match self.find(parent) {
                Some(existing) => {
                    segments.push(Segment { from: lane, to: existing, color: self.colors[existing] })
                }
                None => {
                    let slot = self.free_slot();
                    let color = self.take_color();
                    self.waiting[slot] = Some(parent.clone());
                    self.colors[slot] = color;
                    segments.push(Segment { from: lane, to: slot, color });
                }
            }
        }

        for (index, slot) in self.waiting.iter().enumerate() {
            let was_passing = passing.get(index).copied().unwrap_or(false);
            if index != lane && was_passing && slot.is_some() {
                segments.push(Segment { from: index, to: index, color: self.colors[index] });
            }
        }

        self.trim();
        self.max_width = self.max_width.max(self.waiting.len()).max(lane + 1);

        RowLayout { lane, color, segments }
    }
}

/// Assign lanes across a commit list in one go.
///
/// Production walks in chunks and drives `LaneState::place` directly; this is
/// the whole-history form the tests are written against.
#[cfg(test)]
pub fn assign<C: CommitNode>(commits: &[C]) -> (Vec<RowLayout>, usize) {
    let mut state = LaneState::default();
    let layouts = commits.iter().map(|commit| state.place(commit)).collect();
    (layouts, state.max_width.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Node {
        id: String,
        parents: Vec<String>,
    }

    impl CommitNode for Node {
        fn id(&self) -> &str {
            &self.id
        }
        fn parents(&self) -> &[String] {
            &self.parents
        }
    }

    /// `"c b a"` — first token is the commit, the rest are its parents.
    fn nodes(spec: &[&str]) -> Vec<Node> {
        spec.iter()
            .map(|line| {
                let mut parts = line.split_whitespace();
                let id = parts.next().unwrap().to_string();
                Node { id, parents: parts.map(str::to_string).collect() }
            })
            .collect()
    }

    fn lanes_used(layout: &RowLayout) -> usize {
        layout
            .segments
            .iter()
            .fold(layout.lane + 1, |max, s| max.max(s.from + 1).max(s.to + 1))
    }

    #[test]
    fn linear_history_stays_in_one_lane() {
        let commits = nodes(&["c b", "b a", "a"]);
        let (layout, width) = assign(&commits);
        assert_eq!(width, 1);
        assert!(layout.iter().all(|row| row.lane == 0));
        assert_eq!(layout[0].segments, vec![Segment { from: 0, to: 0, color: 0 }]);
        // The root commit has no parents, so nothing is drawn below it.
        assert!(layout[2].segments.is_empty());
    }

    /// Every line must come from somewhere: a segment may only start in this
    /// row's own lane, or in a lane the row above drew into. Anything else is a
    /// line hanging in mid-air.
    ///
    /// (Two segments *landing* in the same lane is fine — that is two branches
    /// converging on one commit.)
    fn assert_no_line_starts_in_mid_air(layout: &[RowLayout]) {
        if let Some(first) = layout.first() {
            for segment in &first.segments {
                assert_eq!(
                    segment.from, first.lane,
                    "the first row can only draw from its own lane: {:?}",
                    first.segments
                );
            }
        }
        for index in 1..layout.len() {
            let previous = &layout[index - 1];
            for segment in &layout[index].segments {
                let fed = segment.from == layout[index].lane
                    || previous.segments.iter().any(|above| above.to == segment.from);
                assert!(
                    fed,
                    "row {index} draws from lane {}, which nothing above continues into: {:?}",
                    segment.from, layout[index].segments
                );
            }
        }
    }

    #[test]
    fn a_merge_does_not_also_draw_the_lane_it_opens_as_passing() {
        // The lane a merge opens starts at that row. Emitting a pass-through
        // for it as well drew a second line hanging above the branch point.
        let commits = nodes(&["m a f", "a b", "f b", "b"]);
        let (layout, _) = assign(&commits);

        let merge = &layout[0];
        assert_eq!(
            merge.segments.len(),
            2,
            "expected only the two parent links, got {:?}",
            merge.segments
        );
        assert!(merge.segments.iter().any(|s| s.from == 0 && s.to == 0));
        assert!(merge.segments.iter().any(|s| s.from == 0 && s.to == 1));
        assert_no_line_starts_in_mid_air(&layout);
    }

    #[test]
    fn merge_draws_a_segment_to_the_side_branch() {
        //   m        merge of a (first parent) and f (feature)
        //   |\
        //   a f
        //   |/
        //   r
        let commits = nodes(&["m a f", "a r", "f r", "r"]);
        let (layout, width) = assign(&commits);
        assert_eq!(width, 2);
        assert_eq!(layout[0].lane, 0);
        // Merge row: first parent continues in lane 0, second opens lane 1.
        assert!(layout[0].segments.contains(&Segment { from: 0, to: 0, color: 0 }));
        assert!(layout[0].segments.iter().any(|s| s.from == 0 && s.to == 1));
        assert_eq!(layout[1].lane, 0);
        assert_eq!(layout[2].lane, 1);
        // Both branches converge on the root: lane 1 draws across into lane 0.
        assert!(layout[2].segments.iter().any(|s| s.from == 1 && s.to == 0));
        assert_eq!(layout[3].lane, 0);
    }

    #[test]
    fn a_row_carries_lines_for_branches_passing_it() {
        // While the feature branch is open, every row in between must draw it,
        // otherwise a scrolled window would show a line with a hole in it.
        let commits = nodes(&["m a f", "a b", "b r", "f r", "r"]);
        let (layout, _) = assign(&commits);
        let passing = &layout[1]; // commit "a" — feature lane is open beside it
        assert!(passing.segments.contains(&Segment { from: 1, to: 1, color: 1 }));
    }

    #[test]
    fn lanes_are_reused_after_a_branch_closes() {
        // Two short branches that never overlap must share a lane, so width
        // reflects concurrency rather than the number of branches ever seen.
        let commits = nodes(&["m1 a f1", "a b", "f1 b", "b c", "m2 c f2", "c d", "f2 d", "d"]);
        let (layout, width) = assign(&commits);
        assert_eq!(width, 2, "second branch should reuse the freed lane");
        assert!(layout.iter().all(|row| lanes_used(row) <= 2));
    }

    #[test]
    fn octopus_merge_opens_a_lane_per_extra_parent() {
        let commits = nodes(&["o a b c", "a r", "b r", "c r", "r"]);
        let (layout, width) = assign(&commits);
        assert_eq!(width, 3);
        assert_eq!(layout[0].segments.iter().filter(|s| s.from == 0 && s.to != 0).count(), 2);
    }

    #[test]
    fn disjoint_roots_get_their_own_lane() {
        let commits = nodes(&["a1 a0", "a0", "b1 b0", "b0"]);
        let (layout, width) = assign(&commits);
        assert_eq!(width, 1, "the first history closes before the second opens");
        assert!(layout.iter().all(|row| row.lane == 0));
    }

    #[test]
    fn colors_stay_within_the_palette() {
        let commits: Vec<Node> = (0..40)
            .map(|i| Node { id: format!("c{i}"), parents: vec![] })
            .collect();
        let (layout, _) = assign(&commits);
        assert!(layout.iter().all(|row| row.color < PALETTE_SIZE));
    }

    #[test]
    fn empty_history_is_handled() {
        let commits: Vec<Node> = Vec::new();
        let (layout, width) = assign(&commits);
        assert!(layout.is_empty());
        assert_eq!(width, 1);
    }

    #[test]
    fn no_line_ever_starts_in_mid_air() {
        let commits = nodes(&[
            "m a f", "a b", "f g", "b c", "g c", "o c d e", "c x", "d x", "e x", "x",
        ]);
        let (layout, _) = assign(&commits);
        assert_no_line_starts_in_mid_air(&layout);
    }

    #[test]
    fn segments_never_leave_a_gap_between_consecutive_rows() {
        // Every lane a row's segments land in must be occupied by the next row,
        // either by its dot or by one of its own segments. This is the property
        // the windowed renderer relies on.
        let commits = nodes(&[
            "m a f", "a b", "f g", "b c", "g c", "c d", "d e", "e",
        ]);
        let (layout, _) = assign(&commits);
        for i in 0..layout.len() - 1 {
            let next = &layout[i + 1];
            for segment in &layout[i].segments {
                let continues = next.lane == segment.to
                    || next.segments.iter().any(|s| s.from == segment.to);
                assert!(
                    continues,
                    "row {i} draws into lane {} but row {} does not continue it",
                    segment.to,
                    i + 1
                );
            }
        }
    }
}
